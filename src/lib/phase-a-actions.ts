"use server";

import {
  db,
  org,
  documents,
  bankAccounts,
  bankTransactions,
  bankReconciliations,
  recurringTemplates,
  accounts,
  contacts,
  payments,
} from "@/db";
import { and, eq, lte, desc, asc, inArray, sql } from "drizzle-orm";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { withOrg, currentOrgId, getOrg } from "./org";
import { getAccess } from "./access";
import { nowISO, todayISO } from "./money";
import { postEntry, acct, mirrorBankTxn } from "./posting";
import { buildBalanceAdjustmentLines } from "./account-balance-adjustments";
import { SYS } from "./coa";
import { saveDocument, issueDocument, type DocLineInput } from "./actions";
import { advance, dueRuns, addDays, type Frequency } from "./recurring";
import { notifyOrg } from "./notifications";

function revalidatePath(path: string) {
  try {
    nextRevalidatePath(path);
  } catch {
    /* outside request context */
  }
}

/* =========================================================================
 * Bank reconciliation
 * Model: imported/entered bank transactions ARE the statement lines. A
 * session targets one account + a statement closing balance. Reconciled
 * total (all-time ticked) must equal the statement balance to complete.
 * ========================================================================= */

async function reconciledTotal(orgId: number, bankAccountId: number): Promise<number> {
  const [row] = await db
    .select({ v: sql<number>`coalesce(sum(${bankTransactions.amountCents}), 0)` })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.orgId, orgId),
        eq(bankTransactions.bankAccountId, bankAccountId),
        eq(bankTransactions.status, "reconciled")
      )
    );
  return Number(row?.v ?? 0);
}

export async function startReconciliation(data: {
  bankAccountId: number;
  statementDate: string;
  statementBalanceCents: number;
}) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    // Only one open session per account. Previously, clicking "Start
    // reconciliation" while a stale in-progress session already existed
    // (e.g. abandoned days ago) silently resumed that old session with its
    // old date/balance and discarded whatever the user had just typed —
    // reported live as "did bank reconciliation today and it did not pick
    // my statement balance". The user clicked Start, not Resume, so their
    // freshly entered numbers should always win: refresh the existing
    // session's date/balance instead of ignoring the new input.
    const [open] = await db
      .select()
      .from(bankReconciliations)
      .where(
        and(
          eq(bankReconciliations.orgId, orgId),
          eq(bankReconciliations.bankAccountId, data.bankAccountId),
          eq(bankReconciliations.status, "in_progress")
        )
      )
      .limit(1);
    if (open) {
      await db
        .update(bankReconciliations)
        .set({ statementDate: data.statementDate, statementBalanceCents: data.statementBalanceCents })
        .where(eq(bankReconciliations.id, open.id));
      revalidatePath("/banking");
      return open.id;
    }

    const [rec] = await db
      .insert(bankReconciliations)
      .values({
        orgId,
        bankAccountId: data.bankAccountId,
        statementDate: data.statementDate,
        statementBalanceCents: data.statementBalanceCents,
        createdAt: nowISO(),
      })
      .returning();
    revalidatePath("/banking");
    return rec.id;
  });
}

export interface ReconciliationState {
  rec: {
    id: number;
    bankAccountId: number;
    statementDate: string;
    statementBalanceCents: number;
  };
  /** candidate transactions (booked to the ledger, not yet reconciled, dated ≤ statement) */
  candidates: {
    id: number;
    date: string;
    description: string;
    amountCents: number;
    ticked: boolean;
  }[];
  alreadyReconciledCents: number;
  tickedCents: number;
  differenceCents: number; // statement − (alreadyReconciled + ticked)
  /** the bank account's LEDGER balance through the statement date — the books' truth */
  ledgerBalanceCents: number;
  /** lines dated ≤ statement that aren't booked yet — must be categorized before they can reconcile */
  uncategorizedCount: number;
}

export async function getReconciliationState(recId: number): Promise<ReconciliationState | null> {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [rec] = await db
      .select()
      .from(bankReconciliations)
      .where(
        and(
          eq(bankReconciliations.orgId, orgId),
          eq(bankReconciliations.id, recId),
          eq(bankReconciliations.status, "in_progress")
        )
      )
      .limit(1);
    if (!rec) return null;

    // Only lines already booked to the ledger are tickable: reconciling an
    // unbooked line would make the statement "match" while the books don't.
    const txns = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.orgId, orgId),
          eq(bankTransactions.bankAccountId, rec.bankAccountId),
          eq(bankTransactions.status, "categorized"),
          lte(bankTransactions.date, rec.statementDate)
        )
      )
      .orderBy(asc(bankTransactions.date), asc(bankTransactions.id));

    const [uncat] = await db
      .select({ n: sql<number>`count(*)` })
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.orgId, orgId),
          eq(bankTransactions.bankAccountId, rec.bankAccountId),
          eq(bankTransactions.status, "uncategorized"),
          lte(bankTransactions.date, rec.statementDate)
        )
      );

    // Ledger truth: the bank account's journal balance through the statement date.
    const [bank] = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.id, rec.bankAccountId)))
      .limit(1);
    const { journalLines, journalEntries } = await import("@/db");
    const [ledger] = await db
      .select({
        v: sql<number>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .where(
        and(
          eq(journalLines.orgId, orgId),
          eq(journalLines.accountId, bank?.accountId ?? -1),
          lte(journalEntries.date, rec.statementDate)
        )
      );

    const already = await reconciledTotal(orgId, rec.bankAccountId);
    const candidates = txns.map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amountCents: t.amountCents,
      ticked: t.reconciliationId === rec.id,
    }));
    const ticked = candidates.filter((c) => c.ticked).reduce((s, c) => s + c.amountCents, 0);
    // Setting a bank account's opening balance (setMoneyAccountOpeningBalance
    // in actions.ts) posts a real journal entry AND mirrors it into
    // bank_transactions as an ordinary tickable row (external_ref
    // "opening_balance:<id>") — so it's already counted once, correctly,
    // inside `already`/`ticked` above, exactly like any other transaction.
    // An earlier version of this function ALSO subtracted the account's own
    // openingBalanceCents field as a separate term on top of that, double-
    // counting it — which meant the difference could only ever reach zero if
    // the accountant entered a statement balance inflated by the opening
    // balance a second time. Confirmed against a real completed session
    // (org 33, Main Bank Account): the opening-balance row was ticked as
    // part of the session like everything else, and statementBalanceCents
    // only matched once the double subtraction was removed.
    return {
      rec: {
        id: rec.id,
        bankAccountId: rec.bankAccountId,
        statementDate: rec.statementDate,
        statementBalanceCents: rec.statementBalanceCents,
      },
      candidates,
      alreadyReconciledCents: already,
      tickedCents: ticked,
      differenceCents: rec.statementBalanceCents - already - ticked,
      ledgerBalanceCents: Number(ledger?.v ?? 0),
      uncategorizedCount: Number(uncat?.n ?? 0),
    };
  });
}

/**
 * Records the leftover statement/books gap as a single dated adjustment,
 * when there's nothing left to tick or categorize but the difference still
 * isn't zero — e.g. a transaction the bank statement shows that was never
 * entered at all, or an entry error from an earlier period. Posts to
 * "Opening Balance Adjustments" (the same technical clearing account used
 * for money-account opening balances) rather than silently forcing the
 * reconciliation closed, so the accountant sees a flagged, traceable entry
 * to investigate later instead of a black-box "it balances now".
 */
export async function recordReconciliationAdjustment(recId: number, memo: string) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [rec] = await db
      .select()
      .from(bankReconciliations)
      .where(and(eq(bankReconciliations.orgId, orgId), eq(bankReconciliations.id, recId), eq(bankReconciliations.status, "in_progress")))
      .limit(1);
    if (!rec) throw new Error("Reconciliation not found or already closed");
    const state = await getReconciliationState(recId);
    if (!state) throw new Error("Reconciliation not found");
    if (state.differenceCents === 0) throw new Error("Nothing to adjust — the difference is already zero");
    if (state.candidates.some((c) => !c.ticked) || state.uncategorizedCount > 0) {
      throw new Error("Tick or categorize every known transaction first — only record an adjustment once nothing else is left to explain the gap");
    }

    const [bank] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.id, rec.bankAccountId))).limit(1);
    if (!bank) throw new Error("Bank account not found");

    const suspenseAccountId = await acct(SYS.OPENING_BALANCE);
    const adjustmentCents = state.differenceCents;
    const entryId = await postEntry({
      date: rec.statementDate,
      memo: (memo || "Reconciliation adjustment — unexplained statement gap").trim(),
      sourceType: "reconciliation_adjustment",
      sourceId: rec.id,
      lines: buildBalanceAdjustmentLines({
        accountId: bank.accountId,
        accountType: "asset",
        offsetAccountId: suspenseAccountId,
        deltaCents: adjustmentCents,
      }),
    });

    await db.insert(bankTransactions).values({
      orgId,
      bankAccountId: bank.id,
      date: rec.statementDate,
      description: `Reconciliation adjustment · ${memo || "unexplained gap, flagged for follow-up"}`,
      amountCents: adjustmentCents,
      status: "categorized",
      categoryAccountId: suspenseAccountId,
      journalEntryId: entryId,
      reconciliationId: rec.id,
      createdAt: nowISO(),
    });

    revalidatePath("/banking");
  });
}

/** Tick/untick a transaction inside an open session (does not finalize). */
export async function tickReconTxn(recId: number, txnId: number, on: boolean) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    await db
      .update(bankTransactions)
      .set({ reconciliationId: on ? recId : null })
      .where(and(eq(bankTransactions.orgId, orgId), eq(bankTransactions.id, txnId)));
    revalidatePath("/banking");
  });
}

/** Complete: only allowed when difference is zero. Marks ticked txns reconciled. */
export async function completeReconciliation(recId: number) {
  return withOrg(async () => {
    const state = await getReconciliationState(recId);
    if (!state) throw new Error("Reconciliation not found or already closed");
    if (state.differenceCents !== 0) {
      throw new Error(
        "Difference is not zero — keep ticking transactions (or check the statement balance) until it balances."
      );
    }
    const orgId = currentOrgId();
    await db
      .update(bankTransactions)
      .set({ status: "reconciled" })
      .where(
        and(eq(bankTransactions.orgId, orgId), eq(bankTransactions.reconciliationId, recId))
      );
    await db
      .update(bankReconciliations)
      .set({ status: "completed", completedAt: nowISO() })
      .where(and(eq(bankReconciliations.orgId, orgId), eq(bankReconciliations.id, recId)));
    revalidatePath("/banking");
  });
}

export async function cancelReconciliation(recId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    // Clear the session pointer on every ticked line (any status) — leaving a
    // stale reconciliationId would carry ticks into unrelated sessions.
    await db
      .update(bankTransactions)
      .set({ reconciliationId: null })
      .where(
        and(eq(bankTransactions.orgId, orgId), eq(bankTransactions.reconciliationId, recId))
      );
    await db
      .update(bankReconciliations)
      .set({ status: "cancelled" })
      .where(and(eq(bankReconciliations.orgId, orgId), eq(bankReconciliations.id, recId)));
    revalidatePath("/banking");
  });
}

export async function getOpenReconciliation(bankAccountId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [rec] = await db
      .select()
      .from(bankReconciliations)
      .where(
        and(
          eq(bankReconciliations.orgId, orgId),
          eq(bankReconciliations.bankAccountId, bankAccountId),
          eq(bankReconciliations.status, "in_progress")
        )
      )
      .limit(1);
    return rec ?? null;
  });
}

/* =========================================================================
 * Account transfers
 * Pure balance-sheet move between two money accounts (Petty Cash, Main Bank,
 * M-Pesa Till, or any other bank_accounts row) — DR destination · CR source,
 * both at the accounts' real ledger accountId, so it never touches income or
 * expense. Reconciled bank_transactions rows are never modified by this (or
 * anything else): completing a reconciliation is the only thing that sets
 * status='reconciled', and nothing here can un-set or edit a ticked row —
 * a transfer just adds two new, unreconciled candidate lines to each
 * account's own future reconciliation.
 * ========================================================================= */

export async function transferBetweenAccounts(data: {
  date: string;
  amountCents: number;
  fromBankAccountId: number;
  toBankAccountId: number;
  reference?: string;
  notes?: string;
}): Promise<{ success?: true; error?: string }> {
  try {
    return await withOrg(async () => {
      const orgId = currentOrgId();
      if (!Number.isInteger(data.amountCents) || data.amountCents <= 0) throw new Error("Enter a valid amount");
      if (data.fromBankAccountId === data.toBankAccountId) throw new Error("Source and destination must be different accounts");

      const [fromAcct, toAcct] = await Promise.all([
        db.select().from(bankAccounts).where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.id, data.fromBankAccountId))).limit(1),
        db.select().from(bankAccounts).where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.id, data.toBankAccountId))).limit(1),
      ]);
      const from = fromAcct[0];
      const to = toAcct[0];
      if (!from) throw new Error("Source account not found");
      if (!to) throw new Error("Destination account not found");

      // Available balance: the source account's real ledger balance through
      // today — the same "books' truth" the reconciliation screen shows,
      // not just the sum of bank_transactions rows (which would miss the
      // account's opening balance, same bug already fixed for reconciliation).
      const { journalLines, journalEntries } = await import("@/db");
      const [bal] = await db
        .select({ v: sql<number>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}), 0)` })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, from.accountId), lte(journalEntries.date, data.date)));
      const available = Number(bal?.v ?? 0);
      if (data.amountCents > available) {
        throw new Error(`Transfer exceeds ${from.name}'s available balance (${(available / 100).toFixed(2)} KES)`);
      }

      const memo = `Transfer ${from.name} → ${to.name}${data.reference ? ` · ${data.reference}` : ""}`;
      const entryId = await postEntry({
        date: data.date,
        memo,
        sourceType: "account_transfer",
        lines: [
          { accountId: to.accountId, debitCents: data.amountCents, memo: data.notes || undefined },
          { accountId: from.accountId, creditCents: data.amountCents, memo: data.notes || undefined },
        ],
      });

      await mirrorBankTxn({
        bankAccountId: from.id,
        date: data.date,
        description: `Transfer to ${to.name}${data.reference ? ` · ${data.reference}` : ""}`,
        amountCents: -data.amountCents,
        journalEntryId: entryId,
        externalRef: `transfer_out:${entryId}`,
      });
      await mirrorBankTxn({
        bankAccountId: to.id,
        date: data.date,
        description: `Transfer from ${from.name}${data.reference ? ` · ${data.reference}` : ""}`,
        amountCents: data.amountCents,
        journalEntryId: entryId,
        externalRef: `transfer_in:${entryId}`,
      });

      const { logAudit } = await import("./audit");
      await logAudit({
        action: "transfer",
        module: "banking",
        recordId: entryId,
        recordLabel: `${from.name} → ${to.name}`,
        detail: `${(data.amountCents / 100).toFixed(2)} KES${data.reference ? ` · Ref: ${data.reference}` : ""}${data.notes ? ` · ${data.notes}` : ""}`,
      });

      revalidatePath("/banking");
      revalidatePath("/reports");
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Transfer failed" };
  }
}

/* =========================================================================
 * Recurring templates
 * ========================================================================= */

export async function saveRecurringTemplate(data: {
  id?: number;
  name: string;
  docType: "invoice" | "bill" | "expense";
  contactId?: number | null;
  paidFromBankAccountId?: number | null;
  frequency: Frequency;
  nextRunDate: string;
  dueInDays: number;
  taxInclusive: boolean;
  autoIssue: boolean;
  notes?: string;
  assignedMemberId?: number | null;
  lines: DocLineInput[];
}) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    if (!data.name.trim()) throw new Error("Give the recurring template a name");
    if (data.lines.length === 0) throw new Error("Add at least one line");
    if (data.docType !== "expense" && !data.contactId) throw new Error("Choose a contact");
    if (data.docType === "expense" && !data.paidFromBankAccountId)
      throw new Error("Choose the account it's paid from");

    const values = {
      name: data.name.trim(),
      docType: data.docType,
      contactId: data.contactId ?? null,
      paidFromBankAccountId: data.paidFromBankAccountId ?? null,
      frequency: data.frequency,
      nextRunDate: data.nextRunDate,
      dueInDays: data.dueInDays,
      taxInclusive: data.taxInclusive,
      autoIssue: data.autoIssue,
      notes: data.notes ?? null,
      assignedMemberId: data.assignedMemberId ?? null,
      linesJson: JSON.stringify(data.lines),
    };
    if (data.id) {
      await db
        .update(recurringTemplates)
        .set(values)
        .where(and(eq(recurringTemplates.orgId, orgId), eq(recurringTemplates.id, data.id)));
    } else {
      await db.insert(recurringTemplates).values({ orgId, ...values, createdAt: nowISO() });
    }
    revalidatePath("/recurring");
  });
}

export async function setRecurringActive(id: number, active: boolean) {
  return withOrg(async () => {
    await db
      .update(recurringTemplates)
      .set({ active })
      .where(and(eq(recurringTemplates.orgId, currentOrgId()), eq(recurringTemplates.id, id)));
    revalidatePath("/recurring");
  });
}

export async function deleteRecurringTemplate(id: number) {
  return withOrg(async () => {
    await db
      .delete(recurringTemplates)
      .where(and(eq(recurringTemplates.orgId, currentOrgId()), eq(recurringTemplates.id, id)));
    revalidatePath("/recurring");
  });
}

/**
 * Create real documents for every due run of the current org's templates.
 * Called lazily from the dashboard and by /api/cron/recurring. Idempotent-ish:
 * nextRunDate only advances after a successful create, so failures retry.
 */
export async function runDueRecurring(): Promise<{ created: number; stillBehind: string[] }> {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const today = todayISO();
    const due = await db
      .select()
      .from(recurringTemplates)
      .where(
        and(
          eq(recurringTemplates.orgId, orgId),
          eq(recurringTemplates.active, true),
          lte(recurringTemplates.nextRunDate, today)
        )
      );

    let created = 0;
    let unassignedCreated = 0;
    const stillBehind: string[] = [];
    for (const t of due) {
      const runs = dueRuns(t.nextRunDate, t.frequency as Frequency, today);
      let cursor = t.nextRunDate;
      for (const runDate of runs) {
        const lines = JSON.parse(t.linesJson) as DocLineInput[];
        const docId = await saveDocument({
          type: t.docType as "invoice" | "bill" | "expense",
          contactId: t.contactId,
          date: runDate,
          dueDate: t.docType === "invoice" || t.docType === "bill" ? addDays(runDate, t.dueInDays) : null,
          taxInclusive: t.taxInclusive,
          notes: t.notes ? `${t.notes}` : `Recurring: ${t.name}`,
          paidFromBankAccountId: t.paidFromBankAccountId,
          // Assign to the template's owner (if set) so the generated document stays
          // visible to them under data segregation and they — not every accountant/sales
          // person — get pinged (saveDocument fires a per-document "New Assignment"
          // notification straight to this assignee).
          assignedMemberIds: t.assignedMemberId ? [t.assignedMemberId] : undefined,
          lines,
        });
        if (t.autoIssue) {
          await issueDocument(docId);
        }
        created++;
        if (!t.assignedMemberId) unassignedCreated++;
        cursor = advance(runDate, t.frequency as Frequency);
        await db
          .update(recurringTemplates)
          .set({ nextRunDate: cursor, lastRunAt: nowISO() })
          .where(eq(recurringTemplates.id, t.id));
      }
      // dueRuns() caps catch-up per invocation so a template neglected for a long
      // time can't flood the ledger in one go — if it's still behind after this
      // run, surface that instead of letting it look silently caught up.
      if (runs.length > 0 && cursor <= today) {
        stillBehind.push(t.name);
      }
    }
    // Assigned templates already notified their owner per-document (via saveDocument's
    // assignment notification) — only broadcast the role-wide digest for the
    // unassigned ones, so assignees aren't double-pinged and everyone else isn't
    // spammed about documents they can't even see under data segregation.
    if (unassignedCreated > 0) {
      await notifyOrg(
        orgId,
        ["admin", "sales", "accountant"],
        "Recurring Templates Ran",
        `Generated ${unassignedCreated} new document(s) from recurring templates.` +
          (stillBehind.length > 0 ? ` ${stillBehind.length} template(s) are still behind and need another run.` : ""),
        "/sales/invoices"
      );
    }
    if (created > 0) {
      revalidatePath("/");
      revalidatePath("/sales/invoices");
      revalidatePath("/purchases/bills");
    }
    return { created, stillBehind };
  });
}

/* =========================================================================
 * Write-off, drawings, books lock
 * ========================================================================= */

/** Ensure an account exists for this org (used for Bad Debts on older orgs). */
export async function ensureAccount(code: string, name: string, type: "asset" | "liability" | "equity" | "income" | "expense", subtype: string): Promise<number> {
  const orgId = currentOrgId();
  const [existing] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.code, code)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(accounts)
    .values({ orgId, code, name, type, subtype, isSystem: true })
    .returning();
  return created.id;
}

/**
 * Write off the unpaid balance of an invoice as bad debt.
 * DR Bad Debts (expense) + DR VAT Output (reverse the uncollected VAT portion,
 * pro-rata) · CR Accounts Receivable. Marks the invoice written_off.
 */
export async function writeOffInvoice(docId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();

    // Atomic claim: two concurrent write-off clicks (double-click, or a
    // client retry) must not both pass the status check and both post the
    // bad-debt entry — that would double-credit AR and double-book the
    // expense. Every other status-transition-that-posts function in this
    // codebase uses this pattern; this one previously didn't.
    const [doc] = await db
      .update(documents)
      .set({ status: "writing_off" })
      .where(and(eq(documents.orgId, orgId), eq(documents.id, docId), eq(documents.type, "invoice"), sql`${documents.status} IN ('open', 'partial')`))
      .returning();
    if (!doc) throw new Error("Only unpaid invoices can be written off");
    const balance = doc.totalCents - doc.paidCents;
    if (balance <= 0) {
      await db.update(documents).set({ status: doc.paidCents > 0 ? "partial" : "open" }).where(and(eq(documents.orgId, orgId), eq(documents.id, docId), eq(documents.status, "writing_off")));
      throw new Error("Nothing left to write off");
    }

    try {
      // Pro-rata VAT portion of the unpaid balance (KRA allows bad-debt VAT relief
      // subject to conditions; we reverse it and let the accountant adjust if not).
      const vatPortion = doc.totalCents > 0 ? Math.round((balance * doc.taxCents) / doc.totalCents) : 0;
      const netPortion = balance - vatPortion;

      const badDebts = await ensureAccount("6120", "Bad Debts Written Off", "expense", "expense");
      await postEntry({
        date: todayISO(),
        memo: `Write off ${doc.number}`,
        sourceType: "bad_debt_writeoff",
        sourceId: doc.id,
        lines: [
          { accountId: badDebts, debitCents: netPortion, memo: doc.number },
          ...(vatPortion > 0 ? [{ accountId: await acct(SYS.VAT_OUTPUT), debitCents: vatPortion }] : []),
          { accountId: await acct(SYS.AR), creditCents: balance, contactId: doc.contactId },
        ],
      });
      await db
        .update(documents)
        .set({ status: "written_off" })
        .where(and(eq(documents.orgId, orgId), eq(documents.id, docId)));
      revalidatePath("/sales/invoices");
    } catch (e) {
      // Revert the claim to whatever it was before (open vs partial) so the
      // invoice stays write-off-able rather than getting stuck.
      const revertStatus = doc.paidCents > 0 ? "partial" : "open";
      await db.update(documents).set({ status: revertStatus }).where(and(eq(documents.orgId, orgId), eq(documents.id, docId), eq(documents.status, "writing_off")));
      throw e;
    }
  });
}

/** Owner drawings: DR Owner Drawings (equity) · CR bank/cash. */
export async function recordDrawings(bankAccountId: number, amountCents: number, memo?: string) {
  return withOrg(async () => {
    if (amountCents <= 0) throw new Error("Enter a valid amount");
    const orgId = currentOrgId();
    const [bank] = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.id, bankAccountId)))
      .limit(1);
    if (!bank) throw new Error("Money account not found");
    const drawings = await ensureAccount("3100", "Owner Drawings", "equity", "equity");
    const entryId = await postEntry({
      date: todayISO(),
      memo: memo || "Owner drawings",
      sourceType: "drawings",
      lines: [
        { accountId: drawings, debitCents: amountCents },
        { accountId: bank.accountId, creditCents: amountCents },
      ],
    });
    // Mirror into the bank register so reconciliation sees this outflow.
    await mirrorBankTxn({
      bankAccountId: bank.id,
      date: todayISO(),
      description: memo || "Owner drawings",
      amountCents: -amountCents,
      journalEntryId: entryId,
      externalRef: `drw:${entryId}`,
    });
    revalidatePath("/accountant");
  });
}

/** Set/clear the books lock date. Admin only. */
export async function setBooksLock(lockDate: string | null) {
  const access = await getAccess();
  if (!access) throw new Error("Not signed in");
  if (access.role !== "admin") throw new Error("Only admins can lock/unlock the books");
  await db.update(org).set({ lockDate }).where(eq(org.id, access.orgId));
  revalidatePath("/accountant");
}

/* =========================================================================
 * Contact statement data (rendered to PDF by /api/statement/[contactId])
 * ========================================================================= */

export interface StatementLine {
  date: string;
  ref: string;
  description: string;
  debitCents: number; // charges (invoices)
  creditCents: number; // payments / credit notes
  balanceCents: number; // running
}

export async function getStatementData(contactId: number, from: string, to: string) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), eq(contacts.id, contactId)))
      .limit(1);
    if (!contact) throw new Error("Contact not found");
    const o = await getOrg();

    // Vendors owe THIS org, via bills, not invoices — a vendor-kind (or
    // "both") contact previously got an invoice/credit-note-only, inbound-
    // payment-only statement, which meant their bills and every payment OUT
    // to them were silently missing (an empty or wildly wrong statement).
    // "Both" combines everything into one running balance — the net
    // position across both relationships, same model the on-screen
    // StatementTab already uses.
    const isCustomer = contact.kind === "customer" || contact.kind === "both";
    const isVendor = contact.kind === "vendor" || contact.kind === "both";
    const wantedDocTypes = [
      ...(isCustomer ? ["invoice", "credit_note"] : []),
      ...(isVendor ? ["bill"] : []),
    ];
    const docs = wantedDocTypes.length
      ? await db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.orgId, orgId),
              eq(documents.contactId, contactId),
              inArray(documents.type, wantedDocTypes),
              inArray(documents.status, ["open", "partial", "paid", "written_off"])
            )
          )
      : [];
    const wantedDirections = [...(isCustomer ? ["in"] : []), ...(isVendor ? ["out"] : [])];
    const pays = wantedDirections.length
      ? await db
          .select()
          .from(payments)
          .where(
            and(eq(payments.orgId, orgId), eq(payments.contactId, contactId), inArray(payments.direction, wantedDirections))
          )
      : [];

    type Ev = { date: string; ref: string; description: string; d: number; c: number };
    const events: Ev[] = [
      // "d" grows the running balance (what's owed, either direction),
      // "c" shrinks it — matches how invoices/bills (d) and payments/credit
      // notes (c) are tagged below, so opening balance sits consistently on
      // the same side as the document type it's standing in for (an
      // invoice-shaped debt for a customer, a bill-shaped one for a vendor).
      ...(contact.openingBalanceCents !== 0 && contact.openingBalanceDate
        ? [{
            date: contact.openingBalanceDate,
            ref: "OB",
            description: "Balance brought forward",
            d: contact.openingBalanceCents,
            c: 0,
          }]
        : []),
      ...docs
        .filter((x) => x.type === "invoice")
        .map((x) => ({ date: x.date, ref: x.number, description: "Invoice", d: x.totalCents, c: 0 })),
      ...docs
        .filter((x) => x.type === "credit_note")
        .map((x) => ({ date: x.date, ref: x.number, description: "Credit note", d: 0, c: x.totalCents })),
      ...docs
        .filter((x) => x.type === "bill")
        .map((x) => ({ date: x.date, ref: x.number, description: "Bill", d: x.totalCents, c: 0 })),
      ...pays.map((p) => ({
        date: p.date,
        ref: p.number,
        description: `Payment (${p.method})${p.whtCents ? " incl. WHT" : ""}`,
        d: 0,
        c: p.amountCents,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));

    let opening = 0;
    const inRange: StatementLine[] = [];
    let running = 0;
    for (const e of events) {
      if (e.date < from) {
        opening += e.d - e.c;
        continue;
      }
      if (e.date > to) continue;
      running = (inRange.length === 0 ? opening : running) + e.d - e.c;
      inRange.push({
        date: e.date,
        ref: e.ref,
        description: e.description,
        debitCents: e.d,
        creditCents: e.c,
        balanceCents: running,
      });
    }
    const closing = inRange.length ? running : opening;

    return {
      org: { name: o.name, address: o.address, phone: o.phone, email: o.email, logoUrl: o.logoUrl, brandColor: o.brandColor, kraPin: o.kraPin },
      contact: { name: contact.displayName, address: contact.address, kraPin: contact.kraPin },
      from,
      to,
      openingCents: opening,
      closingCents: closing,
      lines: inRange,
    };
  });
}
