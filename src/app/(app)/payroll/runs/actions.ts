"use server";

import { requirePerm } from "@/lib/guard";
import { getOrg, withOrg } from "@/lib/org";
import { db, employees, payrollRuns, payrollRunLineItems, leaveRecords, payrollAdjustments, loanLedger, loanInstallments, statutoryRules, accounts, journalEntries } from "@/db";
import { and, eq } from "drizzle-orm";
import { runPayrollEngine, RuleDef } from "@/lib/payroll";
import { postEntry } from "@/lib/posting";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/** Working days (Mon-Sat) in a "YYYY-MM" month — used to pro-rate unpaid leave, instead of a hardcoded 21. */
function workingDaysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(y, m - 1, d).getDay() !== 0) count++; // exclude Sundays only
  }
  return count;
}

/**
 * Pick the statutory rule effective for this pay period, one per exact `type`.
 * Rules carry effectiveFrom/effectiveTo; if a rate change produced more than one
 * active row for the same type (e.g. old + new NSSF rule), the one with the
 * latest effectiveFrom wins rather than an arbitrary row.
 */
function selectEffectiveRules(allRules: RuleDef[] & { effectiveFrom: string; effectiveTo: string | null }[], month: string): RuleDef[] {
  const periodEnd = new Date(Number(month.split("-")[0]), Number(month.split("-")[1]), 0).toISOString().slice(0, 10);
  const active = allRules.filter((r: any) => r.effectiveFrom <= periodEnd && (!r.effectiveTo || r.effectiveTo >= periodEnd));
  const byType = new Map<string, any>();
  for (const r of active as any[]) {
    const existing = byType.get(r.type);
    if (!existing || r.effectiveFrom > existing.effectiveFrom) byType.set(r.type, r);
  }
  return [...byType.values()];
}

export async function createPayrollRunAction(formData: FormData) {
  await requirePerm("accountant");
  const o = await getOrg();

  const month = formData.get("month") as string;
  if (!month) throw new Error("Month is required");

  // Prevent duplicate runs for same month
  const existing = await db.select().from(payrollRuns).where(and(eq(payrollRuns.orgId, o.id), eq(payrollRuns.month, month)));
  if (existing.length > 0) {
    redirect(`/payroll/runs/${existing[0].id}`);
  }

  const activeEmployees = await db.select().from(employees).where(and(eq(employees.orgId, o.id), eq(employees.isActive, true)));
  if (activeEmployees.length === 0) {
    redirect("/payroll/employees?error=no_active_employees");
  }

  const rulesData = await db.select().from(statutoryRules).where(eq(statutoryRules.orgId, o.id));
  const rules = selectEffectiveRules(rulesData as any, month);
  const daysInMonth = workingDaysInMonth(month);

  const leaves = await db.select().from(leaveRecords).where(and(eq(leaveRecords.orgId, o.id), eq(leaveRecords.month, month)));
  const loans = await db.select().from(loanLedger).where(and(eq(loanLedger.orgId, o.id), eq(loanLedger.status, "active")));

  const run = await db.transaction(async (tx) => {
    const [run] = await tx.insert(payrollRuns).values({
      orgId: o.id,
      month,
      status: "draft",
      createdAt: new Date().toISOString()
    }).returning();

    const adjustments = await tx.select().from(payrollAdjustments).where(and(eq(payrollAdjustments.orgId, o.id), eq(payrollAdjustments.correctingRunId, run.id)));

    for (const emp of activeEmployees) {
      const empLeave = leaves.find(l => l.employeeId === emp.id)?.unpaidDaysCount || 0;
      const empAdjs = adjustments.filter(a => a.employeeId === emp.id).map(a => ({
        amountCents: a.amountCents,
        isTaxable: a.isTaxable,
        isDeduction: a.isDeduction,
        reason: a.reason
      }));

      const empLoans = loans.filter(l => l.employeeId === emp.id).map(l => ({
        amountCents: Math.min(l.installmentCents, l.balanceCents),
        loanId: l.id
      }));

      const lines = runPayrollEngine({
        employeeId: emp.id,
        basicSalaryCents: emp.basicSalaryCents,
        unpaidLeaveDays: empLeave,
        workingDaysInMonth: daysInMonth,
        adjustments: empAdjs,
        loanInstallments: empLoans
      }, rules);

      for (const line of lines) {
        await tx.insert(payrollRunLineItems).values({
          orgId: o.id,
          payrollRunId: run.id,
          employeeId: emp.id,
          type: line.type,
          subType: line.subType,
          amountCents: line.amountCents,
          isDeduction: line.isDeduction,
          statutoryRuleId: line.statutoryRuleId
        });
      }

      for (const loan of empLoans) {
        await tx.insert(loanInstallments).values({
          orgId: o.id,
          loanId: loan.loanId,
          payrollRunId: run.id,
          amountCents: loan.amountCents,
          createdAt: new Date().toISOString()
        });
      }
    }

    return run;
  });

  revalidatePath("/payroll/runs");
  redirect(`/payroll/runs/${run.id}`);
}

export async function postPayrollRunAction(runId: number, formData: FormData) {
  return withOrg(async () => {
    await requirePerm("accountant");
    const o = await getOrg();

    const expenseAccountId = parseInt(formData.get("expenseAccountId") as string, 10);
    const payablesAccountId = parseInt(formData.get("payablesAccountId") as string, 10);
    const taxLiabilitiesAccountId = parseInt(formData.get("taxLiabilitiesAccountId") as string, 10);

    if (!expenseAccountId || !payablesAccountId || !taxLiabilitiesAccountId) {
      throw new Error("Missing account mappings");
    }

    // Atomic claim: flip draft -> posting in one statement so two concurrent
    // posts can't both get past the status check and double-post the journal.
    // A read-then-check leaves that window open.
    const [run] = await db
      .update(payrollRuns)
      .set({ status: "posting" })
      .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.orgId, o.id), eq(payrollRuns.status, "draft")))
      .returning();
    if (!run) {
      const [existing] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.orgId, o.id)));
      if (!existing) throw new Error("Not found");
      throw new Error(existing.status === "posted" ? "Already posted" : "This run is already being posted");
    }

    try {
    const lines = await db.select().from(payrollRunLineItems).where(eq(payrollRunLineItems.payrollRunId, runId));

    let totalGross = 0;
    let totalNet = 0;
    let totalTax = 0;
    let totalLoans = 0;
    let totalEmployerCost = 0;

    for (const line of lines) {
      if (line.type === "gross_pay") {
        totalGross += line.amountCents;
      } else if (line.type === "net_pay") {
        totalNet += line.amountCents;
      } else if (line.type === "deduction" && line.subType === "loan") {
        totalLoans += line.amountCents;
      } else if (line.type === "deduction" && line.subType !== "adjustment") {
        totalTax += line.amountCents;
      } else if (line.type === "employer_cost") {
        totalEmployerCost += line.amountCents;
      }
    }

    let arAccountId: number | null = null;
    if (totalLoans > 0) {
      const [ar] = await db.select().from(accounts).where(and(eq(accounts.orgId, o.id), eq(accounts.code, "1200")));
      if (!ar) throw new Error("Accounts Receivable account (1200) not found. Required for loan recoveries.");
      arAccountId = ar.id;
    }

    const date = new Date(Number(run.month.split("-")[0]), Number(run.month.split("-")[1]), 0).toISOString().slice(0, 10);

    const journalLines = [
      { accountId: expenseAccountId, debitCents: totalGross, creditCents: 0 },
      { accountId: payablesAccountId, debitCents: 0, creditCents: totalNet },
      { accountId: taxLiabilitiesAccountId, debitCents: 0, creditCents: totalTax }
    ];

    if (totalLoans > 0 && arAccountId) {
      journalLines.push({ accountId: arAccountId, debitCents: 0, creditCents: totalLoans });
    }

    // Employer-borne statutory costs (NSSF employer match, AHL employer, NITA) are an
    // additional payroll expense — not deducted from any employee's pay — balanced
    // against the same statutory liability account.
    if (totalEmployerCost > 0) {
      journalLines.push({ accountId: expenseAccountId, debitCents: totalEmployerCost, creditCents: 0 });
      journalLines.push({ accountId: taxLiabilitiesAccountId, debitCents: 0, creditCents: totalEmployerCost });
    }

    const entryId = await postEntry({
      date,
      memo: `Payroll Run for ${run.month}`,
      sourceType: "payroll",
      sourceId: run.id,
      lines: journalLines
    });

    // Journal entry is posted; the run-status flip and loan-balance updates that
    // follow it are grouped so a mid-loop failure can't leave loans half-updated.
    await db.transaction(async (tx) => {
      await tx.update(payrollRuns).set({
        status: "posted",
        journalEntryId: entryId
      }).where(eq(payrollRuns.id, run.id));

      // Update loan balances
      const installments = await tx.select().from(loanInstallments).where(eq(loanInstallments.payrollRunId, run.id));
      for (const inst of installments) {
        const [loan] = await tx.select().from(loanLedger).where(eq(loanLedger.id, inst.loanId));
        if (loan) {
          const newBalance = Math.max(0, loan.balanceCents - inst.amountCents);
          await tx.update(loanLedger).set({
            balanceCents: newBalance,
            status: newBalance === 0 ? "paid" : "active"
          }).where(eq(loanLedger.id, loan.id));
        }
      }
    });

    revalidatePath(`/payroll/runs/${run.id}`);
    revalidatePath("/payroll/runs");
    } catch (err) {
      // Release the claim so the run can be retried. Only safe while it's still
      // "posting" — once the transaction below has flipped it to "posted" the
      // journal entry and loan balances are committed and must not be undone.
      await db
        .update(payrollRuns)
        .set({ status: "draft" })
        .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "posting")));
      throw err;
    }
  });
}

export async function deletePayrollRunAction(runId: number) {
  await requirePerm("accountant");
  const o = await getOrg();

  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.orgId, o.id)));
  if (!run) throw new Error("Not found");
  if (run.status === "posted") throw new Error("Cannot delete a posted run");
  if (run.status === "posting") throw new Error("This run is currently being posted — try again in a moment");

  await db.delete(payrollRunLineItems).where(eq(payrollRunLineItems.payrollRunId, runId));
  await db.delete(loanInstallments).where(eq(loanInstallments.payrollRunId, runId));
  await db.delete(payrollAdjustments).where(eq(payrollAdjustments.correctingRunId, runId));
  await db.delete(payrollRuns).where(eq(payrollRuns.id, runId));

  revalidatePath("/payroll/runs");
  redirect("/payroll/runs");
}

/**
 * Recovers a run stuck in "posting".
 *
 * postPayrollRunAction releases its claim on a thrown error, but not if the
 * process itself dies (deploy, OOM, timeout) between claiming the run and
 * committing. That leaves a run no UI path can act on: the post form and the
 * delete button both require "draft".
 *
 * Which way to recover depends on whether the journal entry made it. The
 * status/loan transaction commits together, so a run still sitting in
 * "posting" never applied its loan balances — completing it here can't
 * double-apply them, and resetting a run whose entry does exist would
 * double-post the ledger on retry, which is why the entry is looked up rather
 * than assumed.
 */
export async function recoverStuckPayrollRunAction(runId: number) {
  return withOrg(async () => {
    await requirePerm("accountant");
    const o = await getOrg();

    const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.orgId, o.id)));
    if (!run) throw new Error("Not found");
    if (run.status !== "posting") throw new Error("This run isn't stuck — nothing to recover");

    const [entry] = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.orgId, o.id), eq(journalEntries.sourceType, "payroll"), eq(journalEntries.sourceId, runId)))
      .limit(1);

    if (!entry) {
      await db.update(payrollRuns).set({ status: "draft" }).where(eq(payrollRuns.id, runId));
      revalidatePath(`/payroll/runs/${runId}`);
      return { recovered: "reset_to_draft" as const };
    }

    // The entry landed — finish what the interrupted post started.
    await db.transaction(async (tx) => {
      await tx.update(payrollRuns).set({ status: "posted", journalEntryId: entry.id }).where(eq(payrollRuns.id, runId));
      const installments = await tx.select().from(loanInstallments).where(eq(loanInstallments.payrollRunId, runId));
      for (const inst of installments) {
        const [loan] = await tx.select().from(loanLedger).where(eq(loanLedger.id, inst.loanId));
        if (loan) {
          const newBalance = Math.max(0, loan.balanceCents - inst.amountCents);
          await tx.update(loanLedger).set({
            balanceCents: newBalance,
            status: newBalance === 0 ? "paid" : "active",
          }).where(eq(loanLedger.id, loan.id));
        }
      }
    });

    revalidatePath(`/payroll/runs/${runId}`);
    revalidatePath("/payroll/runs");
    return { recovered: "completed_post" as const };
  });
}
