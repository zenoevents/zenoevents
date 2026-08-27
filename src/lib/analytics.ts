import {
  db, documents, documentLines, contacts, items, stockLots,
  expenseClaims, employees, payrollRuns, payrollRunLineItems, timeShifts, deals,
  accounts, bankTransactions, journalEntries, journalLines,
  projects, damageReports, manifests, reservations,
} from "@/db";
import { SYS } from "./coa";
import { currentOrgId } from "@/lib/org";
import { and, eq, gte, lte, inArray, sql, desc, ne, isNotNull } from "drizzle-orm";
import { accountBalances, profitAndLoss, cashFlowStatement, vatReturn, aging } from "./reports";

/**
 * Business-owner analytics — all derived from existing ledger/document data,
 * no new source of truth. Every function is org-scoped via currentOrgId()
 * and expects to run inside withOrg(), same convention as reports.ts.
 */

function monthKeys(months: number, offsetYears = 0): { key: string; label: string; from: string; to: string }[] {
  const now = new Date();
  const out: { key: string; label: string; from: string; to: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear() - offsetYears, now.getMonth() - i, 1);
    const nextMonth = new Date(now.getFullYear() - offsetYears, now.getMonth() - i + 1, 0);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      key,
      label: d.toLocaleDateString("en-KE", { month: "short", year: months > 12 ? "2-digit" : undefined }),
      from: `${key}-01`,
      to: nextMonth.toISOString().slice(0, 10),
    });
  }
  return out;
}

/* ---------------- 1. Revenue trend (with YoY) ---------------- */
export async function revenueTrend(months = 12) {
  const thisYear = monthKeys(months, 0);
  const lastYear = monthKeys(months, 1);
  const [cur, prev] = await Promise.all([
    Promise.all(thisYear.map((m) => profitAndLoss(m.from, m.to))),
    Promise.all(lastYear.map((m) => profitAndLoss(m.from, m.to))),
  ]);
  return thisYear.map((m, i) => ({
    label: m.label,
    revenueCents: cur[i].totalIncome,
    revenuePrevYearCents: prev[i].totalIncome,
  }));
}

/* ---------------- 2. Top customers by revenue ---------------- */
export async function topCustomers(limit = 10) {
  const rows = await db
    .select({
      contactId: documents.contactId,
      name: contacts.displayName,
      revenueCents: sql<number>`coalesce(sum(${documents.totalCents} - ${documents.taxCents}), 0)`,
    })
    .from(documents)
    .leftJoin(contacts, eq(documents.contactId, contacts.id))
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.type, "invoice"), sql`${documents.status} != 'draft' AND ${documents.status} != 'void'`))
    .groupBy(documents.contactId, contacts.displayName)
    .orderBy(desc(sql`sum(${documents.totalCents} - ${documents.taxCents})`))
    .limit(limit);
  return rows.map((r) => ({ name: r.name || "Walk-in", revenueCents: Number(r.revenueCents) }));
}

/* ---------------- 3. Top items/services ---------------- */
export async function topItems(limit = 10) {
  const rows = await db
    .select({
      itemId: documentLines.itemId,
      name: items.name,
      qty: sql<number>`coalesce(sum(${documentLines.qty}), 0)`,
      revenueCents: sql<number>`coalesce(sum(${documentLines.netCents}), 0)`,
    })
    .from(documentLines)
    .innerJoin(documents, eq(documentLines.documentId, documents.id))
    .leftJoin(items, eq(documentLines.itemId, items.id))
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.type, "invoice"), sql`${documents.status} != 'draft' AND ${documents.status} != 'void'`))
    .groupBy(documentLines.itemId, items.name)
    .orderBy(desc(sql`sum(${documentLines.netCents})`))
    .limit(limit);
  return rows.map((r) => ({ name: r.name || "Unlisted item", qty: Number(r.qty), revenueCents: Number(r.revenueCents) }));
}

/* ---------------- 4. Quote conversion rate ---------------- */
export async function quoteConversion(months = 6) {
  const range = monthKeys(months);
  const rows = await db
    .select({
      month: sql<string>`substr(${documents.date}, 1, 7)`,
      status: documents.status,
      count: sql<number>`count(*)`,
    })
    .from(documents)
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.type, "quote"), gte(documents.date, range[0].from)))
    .groupBy(sql`substr(${documents.date}, 1, 7)`, documents.status);

  const series = range.map((m) => {
    const inMonth = rows.filter((r) => r.month === m.key);
    const total = inMonth.reduce((s, r) => s + Number(r.count), 0);
    // A quote actually converts to an invoice via convertQuoteToInvoice(),
    // which sets its status to "converted" — "accepted" is only the
    // pre-conversion "client said yes" state and never changes once a
    // quote is converted (_convertQuoteToInvoiceInner overwrites it to
    // "converted" as the terminal state). Counting "accepted" here meant
    // every org's actually-converted quotes were invisible to this metric,
    // permanently showing 0% conversion regardless of real activity.
    const accepted =
      (inMonth.find((r) => r.status === "accepted")?.count || 0) +
      (inMonth.find((r) => r.status === "converted")?.count || 0);
    return { label: m.label, rate: total > 0 ? Math.round((Number(accepted) / total) * 100) : 0, total, accepted: Number(accepted) };
  });
  const totalAll = series.reduce((s, m) => s + m.total, 0);
  const acceptedAll = series.reduce((s, m) => s + m.accepted, 0);
  return { series, overallRate: totalAll > 0 ? Math.round((acceptedAll / totalAll) * 100) : 0, totalAll, acceptedAll };
}

/* ---------------- 6. Cash flow trend ---------------- */
export async function cashFlowTrend(months = 12) {
  const range = monthKeys(months);
  const series = await Promise.all(range.map((m) => cashFlowStatement(m.from, m.to)));
  return range.map((m, i) => ({ label: m.label, netChangeCents: series[i].netChangeActual, netOpCents: series[i].netOp }));
}

/* ---------------- 7. DSO (Days Sales Outstanding) ---------------- */
export async function dso(): Promise<{ days: number; arCents: number; trailingRevenueCents: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const start90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [arAging, pl] = await Promise.all([
    aging("invoice", today),
    profitAndLoss(start90, today),
  ]);
  const dailyRevenue = pl.totalIncome / 90;
  const days = dailyRevenue > 0 ? Math.round(arAging.total / dailyRevenue) : 0;
  return { days, arCents: arAging.total, trailingRevenueCents: pl.totalIncome };
}

/* ---------------- 8. Bank balance trend ---------------- */
export async function bankBalanceTrend(months = 12) {
  const range = monthKeys(months);
  const balances = await Promise.all(range.map((m) => accountBalances({ to: m.to })));
  return range.map((m, i) => {
    const cash = balances[i].filter((b) => b.subtype === "bank" || b.subtype === "cash");
    return { label: m.label, balanceCents: cash.reduce((s, b) => s + b.balanceCents, 0) };
  });
}

/* ---------------- 9. Expense breakdown by category ---------------- */
export async function expenseBreakdown(months = 12) {
  const range = monthKeys(months);
  const balances = await accountBalances({ from: range[0].from, to: range[range.length - 1].to });
  const expenseAccounts = balances.filter((b) => b.type === "expense" && b.balanceCents > 0).sort((a, b) => b.balanceCents - a.balanceCents);
  const top = expenseAccounts.slice(0, 7);
  const rest = expenseAccounts.slice(7);
  const otherCents = rest.reduce((s, b) => s + b.balanceCents, 0);
  const out = top.map((b) => ({ name: b.name, amountCents: b.balanceCents }));
  if (otherCents > 0) out.push({ name: "Other", amountCents: otherCents });
  return out;
}

/* ---------------- 10. Top vendors by spend ---------------- */
export async function topVendors(limit = 10) {
  const rows = await db
    .select({
      contactId: documents.contactId,
      name: contacts.displayName,
      spendCents: sql<number>`coalesce(sum(${documents.totalCents}), 0)`,
    })
    .from(documents)
    .leftJoin(contacts, eq(documents.contactId, contacts.id))
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.type, "bill"), sql`${documents.status} != 'draft' AND ${documents.status} != 'void'`))
    .groupBy(documents.contactId, contacts.displayName)
    .orderBy(desc(sql`sum(${documents.totalCents})`))
    .limit(limit);
  return rows.map((r) => ({ name: r.name || "Unknown vendor", spendCents: Number(r.spendCents) }));
}

/* ---------------- 12. Expense claims stats ---------------- */
export async function expenseClaimsStats() {
  const rows = await db.select().from(expenseClaims).where(eq(expenseClaims.orgId, currentOrgId()));
  const byStatus = { pending: 0, approved: 0, rejected: 0, paid: 0 };
  let totalCents = 0;
  let paidCents = 0;
  let approvalDaysSum = 0;
  let approvalCount = 0;
  for (const c of rows) {
    if (c.status in byStatus) byStatus[c.status as keyof typeof byStatus]++;
    totalCents += c.amountCents || 0;
    if (c.status === "paid") paidCents += c.amountCents || 0;
    if (c.reviewedAt) {
      approvalDaysSum += (new Date(c.reviewedAt).getTime() - new Date(c.createdAt).getTime()) / 86400000;
      approvalCount++;
    }
  }
  return {
    byStatus,
    total: rows.length,
    totalCents,
    paidCents,
    avgApprovalDays: approvalCount > 0 ? Math.round((approvalDaysSum / approvalCount) * 10) / 10 : null,
  };
}

/* ---------------- 13. Margin trend ---------------- */
export async function marginTrend(months = 12) {
  const range = monthKeys(months);
  const series = await Promise.all(range.map((m) => profitAndLoss(m.from, m.to)));
  return range.map((m, i) => {
    const pl = series[i];
    return {
      label: m.label,
      grossMarginPct: pl.totalIncome > 0 ? Math.round((pl.grossProfit / pl.totalIncome) * 1000) / 10 : 0,
      netMarginPct: pl.totalIncome > 0 ? Math.round((pl.netProfit / pl.totalIncome) * 1000) / 10 : 0,
    };
  });
}

/* ---------------- 15. Profitability by customer ---------------- */
export async function profitabilityByCustomer(limit = 15) {
  const rows = await db
    .select({
      contactId: documents.contactId,
      name: contacts.displayName,
      revenueCents: sql<number>`coalesce(sum(${documentLines.netCents}), 0)`,
      cogsCents: sql<number>`coalesce(sum(${documentLines.cogsCents}), 0)`,
    })
    .from(documentLines)
    .innerJoin(documents, eq(documentLines.documentId, documents.id))
    .leftJoin(contacts, eq(documents.contactId, contacts.id))
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.type, "invoice"), sql`${documents.status} != 'draft' AND ${documents.status} != 'void'`))
    .groupBy(documents.contactId, contacts.displayName)
    .orderBy(desc(sql`sum(${documentLines.netCents}) - sum(${documentLines.cogsCents})`))
    .limit(limit);
  return rows.map((r) => {
    const revenue = Number(r.revenueCents);
    const cogs = Number(r.cogsCents);
    const profit = revenue - cogs;
    return { name: r.name || "Walk-in", revenueCents: revenue, profitCents: profit, marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0 };
  });
}

/* ---------------- 16. Stock value snapshot (current, by item) ---------------- */
export async function stockValueByItem(limit = 10) {
  const rows = await db
    .select({
      itemId: stockLots.itemId,
      name: items.name,
      qty: sql<number>`coalesce(sum(${stockLots.remainingQty}), 0)`,
      valueCents: sql<number>`coalesce(sum(${stockLots.remainingQty} * ${stockLots.unitCostCents}), 0)`,
    })
    .from(stockLots)
    .innerJoin(items, eq(stockLots.itemId, items.id))
    .where(and(eq(stockLots.orgId, currentOrgId()), sql`${stockLots.remainingQty} > 0`))
    .groupBy(stockLots.itemId, items.name)
    .orderBy(desc(sql`sum(${stockLots.remainingQty} * ${stockLots.unitCostCents})`))
    .limit(limit);
  const total = rows.reduce((s, r) => s + Number(r.valueCents), 0);
  return { rows: rows.map((r) => ({ name: r.name, qty: Number(r.qty), valueCents: Number(r.valueCents) })), totalCents: total };
}

/* ---------------- 17. Fast/slow movers ---------------- */
export async function fastSlowMovers(limit = 10) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [sold, stock] = await Promise.all([
    db.select({
      itemId: documentLines.itemId,
      qtySold: sql<number>`coalesce(sum(${documentLines.qty}), 0)`,
    })
      .from(documentLines)
      .innerJoin(documents, eq(documentLines.documentId, documents.id))
      .where(and(eq(documents.orgId, currentOrgId()), eq(documents.type, "invoice"), gte(documents.date, since), sql`${documents.status} != 'draft' AND ${documents.status} != 'void'`))
      .groupBy(documentLines.itemId),
    db.select({
      itemId: stockLots.itemId,
      name: items.name,
      qtyOnHand: sql<number>`coalesce(sum(${stockLots.remainingQty}), 0)`,
    })
      .from(stockLots)
      .innerJoin(items, eq(stockLots.itemId, items.id))
      .where(and(eq(stockLots.orgId, currentOrgId()), sql`${stockLots.remainingQty} > 0`))
      .groupBy(stockLots.itemId, items.name),
  ]);
  const soldMap = new Map(sold.map((s) => [s.itemId, Number(s.qtySold)]));
  const withTurnover = stock.map((s) => {
    const qtySold90d = soldMap.get(s.itemId) || 0;
    const qtyOnHand = Number(s.qtyOnHand);
    return { name: s.name, qtyOnHand, qtySold90d, turnover: qtyOnHand > 0 ? Math.round((qtySold90d / qtyOnHand) * 100) / 100 : qtySold90d > 0 ? Infinity : 0 };
  });
  const sorted = [...withTurnover].sort((a, b) => b.turnover - a.turnover);
  return { fastest: sorted.slice(0, limit), slowest: sorted.slice(-limit).reverse() };
}

/* ---------------- 18. Dead stock ---------------- */
export async function deadStock(days = 60, limit = 15) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const [stock, recentSales] = await Promise.all([
    db.select({
      itemId: stockLots.itemId,
      name: items.name,
      qtyOnHand: sql<number>`coalesce(sum(${stockLots.remainingQty}), 0)`,
      valueCents: sql<number>`coalesce(sum(${stockLots.remainingQty} * ${stockLots.unitCostCents}), 0)`,
    })
      .from(stockLots)
      .innerJoin(items, eq(stockLots.itemId, items.id))
      .where(and(eq(stockLots.orgId, currentOrgId()), sql`${stockLots.remainingQty} > 0`))
      .groupBy(stockLots.itemId, items.name),
    db.selectDistinct({ itemId: documentLines.itemId })
      .from(documentLines)
      .innerJoin(documents, eq(documentLines.documentId, documents.id))
      .where(and(eq(documents.orgId, currentOrgId()), eq(documents.type, "invoice"), gte(documents.date, since))),
  ]);
  const soldRecently = new Set(recentSales.map((r) => r.itemId));
  return stock
    .filter((s) => !soldRecently.has(s.itemId))
    .map((s) => ({ name: s.name, qtyOnHand: Number(s.qtyOnHand), valueCents: Number(s.valueCents) }))
    .sort((a, b) => b.valueCents - a.valueCents)
    .slice(0, limit);
}

/* ---------------- 19. Payroll cost trend ---------------- */
export async function payrollCostTrend(months = 12) {
  const range = monthKeys(months);
  const rows = await db
    .select({
      month: payrollRuns.month,
      grossCents: sql<number>`coalesce(sum(${payrollRunLineItems.amountCents}), 0)`,
    })
    .from(payrollRunLineItems)
    .innerJoin(payrollRuns, eq(payrollRunLineItems.payrollRunId, payrollRuns.id))
    .where(and(eq(payrollRuns.orgId, currentOrgId()), eq(payrollRunLineItems.type, "gross_pay"), eq(payrollRuns.status, "posted")))
    .groupBy(payrollRuns.month);
  const byMonth = new Map(rows.map((r) => [r.month, Number(r.grossCents)]));
  return range.map((m) => ({ label: m.label, grossCents: byMonth.get(m.key) || 0 }));
}

/* ---------------- 20. New hires per month (headcount proxy) ---------------- */
export async function newHiresTrend(months = 12) {
  const range = monthKeys(months);
  const rows = await db
    .select({ month: sql<string>`substr(${employees.createdAt}, 1, 7)`, count: sql<number>`count(*)` })
    .from(employees)
    .where(eq(employees.orgId, currentOrgId()))
    .groupBy(sql`substr(${employees.createdAt}, 1, 7)`);
  const byMonth = new Map(rows.map((r) => [r.month, Number(r.count)]));
  const [activeCount] = await db.select({ count: sql<number>`count(*)` }).from(employees).where(and(eq(employees.orgId, currentOrgId()), eq(employees.isActive, true)));
  return { series: range.map((m) => ({ label: m.label, hires: byMonth.get(m.key) || 0 })), activeHeadcount: Number(activeCount.count) };
}

/* ---------------- 21. Time tracking hours per staff (last N weeks) ---------------- */
export async function timeTrackingHours(weeks = 8) {
  const since = new Date(Date.now() - weeks * 7 * 86400000).toISOString();
  const rows = await db.select().from(timeShifts).where(and(eq(timeShifts.orgId, currentOrgId()), gte(timeShifts.clockInAt, since)));
  const byPerson = new Map<string, number>();
  for (const r of rows) {
    if (!r.durationSeconds) continue;
    byPerson.set(r.personName, (byPerson.get(r.personName) || 0) + r.durationSeconds);
  }
  return Array.from(byPerson.entries())
    .map(([name, seconds]) => ({ name, hours: Math.round((seconds / 3600) * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);
}

/* ---------------- 22 & 23. Pipeline by stage + win rate ---------------- */
export async function pipelineByStage() {
  const rows = await db
    .select({ stage: deals.stage, count: sql<number>`count(*)`, valueCents: sql<number>`coalesce(sum(${deals.amountCents}), 0)` })
    .from(deals)
    .where(eq(deals.orgId, currentOrgId()))
    .groupBy(deals.stage);
  const order = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];
  const byStage = new Map(rows.map((r) => [r.stage, { count: Number(r.count), valueCents: Number(r.valueCents) }]));
  const stages = order.map((s) => ({ stage: s, ...(byStage.get(s) || { count: 0, valueCents: 0 }) }));
  const won = byStage.get("won")?.count || 0;
  const lost = byStage.get("lost")?.count || 0;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;
  return { stages, winRate, won, lost };
}

/* ---------------- 24. New vs returning customers ---------------- */
export async function newVsReturningCustomers(months = 12) {
  const range = monthKeys(months);
  const rows = await db
    .select({ contactId: documents.contactId, date: documents.date })
    .from(documents)
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.type, "invoice"), sql`${documents.status} != 'draft' AND ${documents.status} != 'void'`));
  const firstInvoiceByContact = new Map<number, string>();
  for (const r of rows) {
    if (!r.contactId) continue;
    const existing = firstInvoiceByContact.get(r.contactId);
    if (!existing || r.date < existing) firstInvoiceByContact.set(r.contactId, r.date);
  }
  return range.map((m) => {
    let newCount = 0;
    let returningCount = 0;
    const seenThisMonth = new Set<number>();
    for (const r of rows) {
      if (!r.contactId) continue;
      const month = r.date.slice(0, 7);
      if (month !== m.key || seenThisMonth.has(r.contactId)) continue;
      seenThisMonth.add(r.contactId);
      const first = firstInvoiceByContact.get(r.contactId);
      if (first && first.slice(0, 7) === m.key) newCount++;
      else returningCount++;
    }
    return { label: m.label, newCustomers: newCount, returningCustomers: returningCount };
  });
}

/* ---------------- 25. VAT position trend ---------------- */
export async function vatPositionTrend(months = 12) {
  const range = monthKeys(months);
  const series = await Promise.all(range.map((m) => vatReturn(m.from, m.to)));
  return range.map((m, i) => ({ label: m.label, netVatDueCents: series[i].netVatDue, outputVat: series[i].outputVat, inputVat: series[i].inputVat }));
}

/* ---------------- 26. Withholding Tax (WHT) position trend ---------------- */
export async function whtPositionTrend(months = 12) {
  const range = monthKeys(months);
  const orgId = currentOrgId();

  const [whtAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.code, SYS.WHT_RECEIVABLE)))
    .limit(1);

  if (!whtAccount) {
    return range.map((m) => ({ label: m.label, whtClaimableCents: 0 }));
  }

  const lines = await db
    .select({
      date: journalEntries.date,
      debitCents: journalLines.debitCents,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.orgId, orgId),
        eq(journalLines.accountId, whtAccount.id),
        gte(journalEntries.date, range[0].from),
        lte(journalEntries.date, range[range.length - 1].to)
      )
    );

  const byMonth = new Map<string, number>();
  for (const l of lines) {
    const key = l.date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) || 0) + Number(l.debitCents));
  }

  return range.map((m) => ({
    label: m.label,
    whtClaimableCents: byMonth.get(m.key) || 0,
  }));
}

/* ---------------- 27. Books health & Accounting Audit ---------------- */
export async function booksHealth(orgLockDate: string | null) {
  const orgId = currentOrgId();
  const today = new Date().toISOString().slice(0, 10);

  const [balances, uncategorizedCount, pendingBillsCount, openCreditsCount, entriesCount, lastReconRow] = await Promise.all([
    accountBalances({ to: today }),
    db.select({ count: sql<number>`count(*)` })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.orgId, orgId), eq(bankTransactions.status, "uncategorized")))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` })
      .from(documents)
      .where(and(eq(documents.orgId, orgId), eq(documents.type, "bill"), eq(documents.status, "pending_approval")))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` })
      .from(documents)
      .where(and(eq(documents.orgId, orgId), eq(documents.type, "credit_note"), sql`${documents.status} IN ('open', 'partial')`))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)`, totalCents: sql<number>`coalesce(sum(abs(${journalLines.debitCents})), 0)` })
      .from(journalLines)
      .where(eq(journalLines.orgId, orgId))
      .then((r) => ({ count: Number(r[0]?.count || 0), totalCents: Number(r[0]?.totalCents || 0) })),
    db.execute<{ completed_at: string }>(sql`
      select completed_at from bank_reconciliations
      where org_id = ${orgId} and status = 'completed'
      order by completed_at desc limit 1
    `).then((r: any) => (r.rows ?? r)[0]?.completed_at ?? null),
  ]);

  const totalDr = balances.reduce((s, b) => s + b.debitCents, 0);
  const totalCr = balances.reduce((s, b) => s + b.creditCents, 0);
  const varianceCents = Math.abs(totalDr - totalCr);

  return {
    balanced: varianceCents === 0,
    totalDr,
    totalCr,
    varianceCents,
    uncategorizedCount,
    pendingBillsCount,
    openCreditsCount,
    entriesCount: entriesCount.count,
    totalLedgerVolumeCents: entriesCount.totalCents,
    lockDate: orgLockDate,
    lastReconciliationDate: lastReconRow,
  };
}

/* ---------------- Events analytics ---------------- */

const EVENT_TYPE_LABEL = "Uncategorized";

/** Every non-cancelled project's financials, grouped by eventType — the
 *  shared base most of the events charts below aggregate from. */
async function projectFinancialsByType() {
  const orgId = currentOrgId();
  const rows = await db
    .select({
      projectId: projects.id,
      eventType: projects.eventType,
      status: projects.status,
      budgetCents: projects.budgetCents,
      contactId: projects.contactId,
      createdAt: projects.createdAt,
      eventDate: projects.eventDate,
    })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), ne(projects.status, "cancelled")));

  const projectIds = rows.map((r) => r.projectId);
  const docTotals = projectIds.length === 0 ? [] : await db
    .select({
      projectId: documents.projectId,
      type: documents.type,
      totalCents: sql<number>`coalesce(sum(${documents.totalCents}), 0)`,
    })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), inArray(documents.projectId, projectIds), ne(documents.status, "void")))
    .groupBy(documents.projectId, documents.type);

  const invoicedByProject = new Map<number, number>();
  const costByProject = new Map<number, number>();
  for (const d of docTotals) {
    if (!d.projectId) continue;
    if (d.type === "invoice") invoicedByProject.set(d.projectId, (invoicedByProject.get(d.projectId) ?? 0) + Number(d.totalCents));
    if (d.type === "bill" || d.type === "expense") costByProject.set(d.projectId, (costByProject.get(d.projectId) ?? 0) + Number(d.totalCents));
  }

  return rows.map((r) => ({
    ...r,
    eventType: r.eventType || EVENT_TYPE_LABEL,
    invoicedCents: invoicedByProject.get(r.projectId) ?? 0,
    costCents: costByProject.get(r.projectId) ?? 0,
  }));
}

/** #1 Radial ring — margin % by event type. */
export async function marginByEventType() {
  const projectsWithFinancials = await projectFinancialsByType();
  const byType = new Map<string, { invoiced: number; cost: number }>();
  for (const p of projectsWithFinancials) {
    const entry = byType.get(p.eventType) ?? { invoiced: 0, cost: 0 };
    entry.invoiced += p.invoicedCents;
    entry.cost += p.costCents;
    byType.set(p.eventType, entry);
  }
  return [...byType.entries()]
    .filter(([, v]) => v.invoiced > 0)
    .map(([name, v]) => ({ name, pct: Math.max(0, Math.min(100, Math.round(((v.invoiced - v.cost) / v.invoiced) * 100))) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);
}

/** #2 Radial trend — event count by calendar month, trailing 12mo, as a closed loop. */
export async function seasonalBookingCurve() {
  const orgId = currentOrgId();
  const rows = await db
    .select({ month: sql<string>`to_char(${projects.eventDate}::date, 'Mon')`, monthNum: sql<number>`extract(month from ${projects.eventDate}::date)` , count: sql<number>`count(*)`.mapWith(Number) })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), ne(projects.status, "cancelled")))
    .groupBy(sql`to_char(${projects.eventDate}::date, 'Mon'), extract(month from ${projects.eventDate}::date)`);

  const byMonth = new Map(rows.map((r) => [Number(r.monthNum), r.count]));
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return monthLabels.map((label, i) => ({ label, value: byMonth.get(i + 1) ?? 0 }));
}

/** #3 Nested donut — bookings by event type (outer), by status (inner). */
export async function bookingsByTypeAndStatus() {
  const projectsWithFinancials = await projectFinancialsByType();
  const byType = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const p of projectsWithFinancials) {
    byType.set(p.eventType, (byType.get(p.eventType) ?? 0) + 1);
    byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
  }
  return {
    outer: [...byType.entries()].map(([name, value]) => ({ name, value })),
    inner: [...byStatus.entries()].map(([name, value]) => ({ name, value })),
  };
}

/** #4 Range bar — booking lead time (days between project created and event date), by month. */
export async function bookingLeadTimeRange() {
  const projectsWithFinancials = await projectFinancialsByType();
  const byMonth = new Map<string, number[]>();
  for (const p of projectsWithFinancials) {
    const created = new Date(p.createdAt);
    const eventDate = new Date(p.eventDate);
    const days = Math.round((eventDate.getTime() - created.getTime()) / 86400000);
    if (!Number.isFinite(days) || days < 0) continue;
    const key = eventDate.toLocaleDateString("en-KE", { month: "short" });
    const arr = byMonth.get(key) ?? [];
    arr.push(days);
    byMonth.set(key, arr);
  }
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return monthLabels
    .map((label) => ({ label, days: byMonth.get(label) }))
    .filter((m) => m.days && m.days.length > 0)
    .map((m) => ({ label: m.label, range: [Math.min(...m.days!), Math.max(...m.days!)] as [number, number] }));
}

/** #5 Scatter — budget vs actual invoiced, one dot per project, by event type. */
export async function budgetVsActualScatter() {
  const projectsWithFinancials = await projectFinancialsByType();
  const byType = new Map<string, { x: number; y: number; label: string }[]>();
  for (const p of projectsWithFinancials) {
    if (!p.budgetCents || p.budgetCents <= 0) continue;
    const arr = byType.get(p.eventType) ?? [];
    arr.push({ x: p.budgetCents, y: p.invoicedCents, label: p.eventType });
    byType.set(p.eventType, arr);
  }
  return [...byType.entries()].map(([name, points]) => ({ name, points }));
}

/** #6 Sankey — booking → billing flow. */
export async function bookingToBillingFlow() {
  const orgId = currentOrgId();
  const statusRows = await db
    .select({ status: projects.status, count: sql<number>`count(*)`.mapWith(Number) })
    .from(projects).where(eq(projects.orgId, orgId)).groupBy(projects.status);
  const counts = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));

  const [invoicedRow] = await db
    .select({ total: sql<number>`coalesce(sum(${documents.totalCents}), 0)`, paid: sql<number>`coalesce(sum(${documents.paidCents}), 0)` })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(and(eq(documents.orgId, orgId), eq(documents.type, "invoice"), ne(documents.status, "void"), ne(projects.status, "cancelled")));

  const invoicedCents = Number(invoicedRow?.total ?? 0);
  const collectedCents = Number(invoicedRow?.paid ?? 0);
  const outstandingCents = Math.max(0, invoicedCents - collectedCents);

  const lead = counts.lead ?? 0;
  const quoted = counts.quoted ?? 0;
  const confirmed = counts.confirmed ?? 0;
  const inProgress = counts.in_progress ?? 0;
  const completed = counts.completed ?? 0;
  const cancelled = counts.cancelled ?? 0;
  const confirmedPlus = confirmed + inProgress + completed;

  const nodeNames = ["Leads", "Quoted", "Confirmed+", "Cancelled", "Invoiced", "Collected", "Outstanding"];
  const idx = Object.fromEntries(nodeNames.map((n, i) => [n, i]));
  const links: { source: number; target: number; value: number }[] = [];
  if (lead > 0) links.push({ source: idx.Leads, target: idx.Quoted, value: lead });
  if (quoted > 0) links.push({ source: idx.Quoted, target: idx["Confirmed+"], value: quoted });
  if (cancelled > 0) links.push({ source: idx.Leads, target: idx.Cancelled, value: cancelled });
  if (confirmedPlus > 0 && invoicedCents > 0) links.push({ source: idx["Confirmed+"], target: idx.Invoiced, value: Math.round(invoicedCents / 100) });
  if (collectedCents > 0) links.push({ source: idx.Invoiced, target: idx.Collected, value: Math.round(collectedCents / 100) });
  if (outstandingCents > 0) links.push({ source: idx.Invoiced, target: idx.Outstanding, value: Math.round(outstandingCents / 100) });

  return { nodes: nodeNames.map((name) => ({ name })), links };
}

/** #7 Radar — event-type performance profile across 4 honestly-available axes. */
export async function eventTypePerformanceProfile() {
  const orgId = currentOrgId();
  const projectsWithFinancials = await projectFinancialsByType();
  const projectIds = projectsWithFinancials.map((p) => p.projectId);
  if (projectIds.length === 0) {
    return { data: [{ axis: "Margin %", value: 0 }, { axis: "Damage-free %", value: 0 }, { axis: "Reconciled %", value: 0 }, { axis: "Repeat clients %", value: 0 }], series: [] as { key: string; label: string; color: string }[] };
  }

  const [damageRows, manifestRows, contactCounts] = await Promise.all([
    db.select({ projectId: damageReports.projectId }).from(damageReports).where(and(eq(damageReports.orgId, orgId), inArray(damageReports.projectId, projectIds))),
    db.select({ projectId: manifests.projectId, status: manifests.status }).from(manifests).where(and(eq(manifests.orgId, orgId), inArray(manifests.projectId, projectIds))),
    db.select({ contactId: projects.contactId, count: sql<number>`count(*)`.mapWith(Number) }).from(projects)
      .where(and(eq(projects.orgId, orgId), isNotNull(projects.contactId))).groupBy(projects.contactId),
  ]);

  const damagedProjectIds = new Set(damageRows.map((d) => d.projectId).filter((id): id is number => id != null));
  const reconciledCount = manifestRows.filter((m) => m.status === "reconciled").length;
  const repeatClientIds = new Set(contactCounts.filter((c) => c.count > 1).map((c) => c.contactId));

  const totalInvoiced = projectsWithFinancials.reduce((s, p) => s + p.invoicedCents, 0);
  const totalCost = projectsWithFinancials.reduce((s, p) => s + p.costCents, 0);
  const marginPct = totalInvoiced > 0 ? Math.max(0, Math.min(100, Math.round(((totalInvoiced - totalCost) / totalInvoiced) * 100))) : 0;
  const damageFreePct = Math.round(((projectIds.length - damagedProjectIds.size) / projectIds.length) * 100);
  const reconciledPct = manifestRows.length > 0 ? Math.round((reconciledCount / manifestRows.length) * 100) : 0;
  const repeatClientProjects = projectsWithFinancials.filter((p) => p.contactId && repeatClientIds.has(p.contactId)).length;
  const repeatClientPct = Math.round((repeatClientProjects / projectIds.length) * 100);

  return {
    data: [
      { axis: "Margin %", value: marginPct },
      { axis: "Damage-free %", value: damageFreePct },
      { axis: "Reconciled %", value: reconciledPct },
      { axis: "Repeat clients %", value: repeatClientPct },
    ],
    series: [{ key: "value", label: "All projects", color: "var(--color-brand, #0f766e)" }],
  };
}

const FUNNEL_COLORS: Record<string, string> = {
  Lead: "#d2d2d7", Quoted: "#93c5fd", Confirmed: "#5eead4", Completed: "var(--color-brand, #0f766e)",
};

/** #8 Funnel — Lead → Quoted → Confirmed → Completed, real counts. */
export async function salesFunnelStages() {
  const orgId = currentOrgId();
  const rows = await db
    .select({ status: projects.status, count: sql<number>`count(*)`.mapWith(Number) })
    .from(projects).where(and(eq(projects.orgId, orgId), ne(projects.status, "cancelled"))).groupBy(projects.status);
  const counts = Object.fromEntries(rows.map((r) => [r.status, r.count]));

  const lead = (counts.lead ?? 0) + (counts.quoted ?? 0) + (counts.confirmed ?? 0) + (counts.in_progress ?? 0) + (counts.completed ?? 0);
  const quoted = (counts.quoted ?? 0) + (counts.confirmed ?? 0) + (counts.in_progress ?? 0) + (counts.completed ?? 0);
  const confirmed = (counts.confirmed ?? 0) + (counts.in_progress ?? 0) + (counts.completed ?? 0);
  const completed = counts.completed ?? 0;

  return [
    { name: "Lead", value: lead, fill: FUNNEL_COLORS.Lead },
    { name: "Quoted", value: quoted, fill: FUNNEL_COLORS.Quoted },
    { name: "Confirmed", value: confirmed, fill: FUNNEL_COLORS.Confirmed },
    { name: "Completed", value: completed, fill: FUNNEL_COLORS.Completed },
  ];
}
