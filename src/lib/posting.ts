import {
  db,
  accounts,
  documents,
  documentLines,
  journalEntries,
  journalLines,
  bankAccounts,
  bankTransactions,
  items,
  org as orgTable,
  payments as paymentsTable,
} from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { currentOrgId } from "@/lib/org";
import { SYS } from "./coa";
import { addLot, consumeFifo, consumeForSale, restoreSaleConsumption, checkStockAvailability, type BomComponentConsumption } from "./inventory";
import { nowISO } from "./money";
import { advanceProjectStatus } from "./project-status-advance";

/**
 * The posting engine — the ONLY writer to journal_entries / journal_lines.
 * Every function throws if debits ≠ credits.
 */

export interface PostLine {
  accountId: number;
  debitCents?: number;
  creditCents?: number;
  contactId?: number | null;
  memo?: string;
  costCenterId?: number | null;
}

/** Cache keyed per-org: same account code maps to different ids per org. */
const codeCache = new Map<string, number>();
export async function acct(code: string): Promise<number> {
  const orgId = currentOrgId();
  const key = `${orgId}:${code}`;
  const hit = codeCache.get(key);
  if (hit) return hit;
  const [row] = await db.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.code, code))).limit(1);
  if (!row) throw new Error(`System account ${code} missing — run db:seed`);
  codeCache.set(key, row.id);
  return row.id;
}

/** Like acct(), but creates the account (as a system account) if it's
 *  missing instead of throwing — for accounts introduced after an org was
 *  first seeded, so existing orgs don't need a backfill migration. */
async function ensureAccountId(code: string, name: string, type: "asset" | "liability" | "equity" | "income" | "expense", subtype: string): Promise<number> {
  const orgId = currentOrgId();
  const key = `${orgId}:${code}`;
  const hit = codeCache.get(key);
  if (hit) return hit;
  const [row] = await db.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.code, code))).limit(1);
  if (row) {
    codeCache.set(key, row.id);
    return row.id;
  }
  const [created] = await db.insert(accounts).values({ orgId, code, name, type, subtype, isSystem: true }).returning();
  codeCache.set(key, created.id);
  return created.id;
}

export async function postEntry(params: {
  date: string;
  memo?: string;
  sourceType: string;
  sourceId?: number;
  reversalOfId?: number;
  lines: PostLine[];
}): Promise<number> {
  const lines = params.lines.filter(
    (l) => (l.debitCents ?? 0) !== 0 || (l.creditCents ?? 0) !== 0
  );
  const dr = lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
  const cr = lines.reduce((s, l) => s + (l.creditCents ?? 0), 0);
  if (dr !== cr) {
    throw new Error(`Unbalanced entry (${params.sourceType}): dr ${dr} ≠ cr ${cr}`);
  }
  if (lines.length === 0) throw new Error("Empty journal entry");

  // Books lock: nothing may post into a closed period (see org.lockDate).
  const { org: orgTable } = await import("@/db");
  const [orgRow] = await db
    .select({ lockDate: orgTable.lockDate })
    .from(orgTable)
    .where(eq(orgTable.id, currentOrgId()))
    .limit(1);
  if (orgRow?.lockDate && params.date <= orgRow.lockDate) {
    throw new Error(
      `Books are locked through ${orgRow.lockDate} — this entry is dated ${params.date}. Unlock in Accountant → Books lock first.`
    );
  }

  const [entry] = await db
    .insert(journalEntries)
    .values({
      orgId: currentOrgId(),
      date: params.date,
      memo: params.memo,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      reversalOfId: params.reversalOfId,
      createdAt: nowISO(),
    })
    .returning();

  await db.insert(journalLines).values(
    lines.map((l) => ({
      orgId: currentOrgId(),
      entryId: entry.id,
      accountId: l.accountId,
      debitCents: l.debitCents ?? 0,
      creditCents: l.creditCents ?? 0,
      contactId: l.contactId ?? null,
      memo: l.memo,
      costCenterId: l.costCenterId ?? null,
    }))
  );
  return entry.id;
}

/** Post a reversal of an existing entry (used by void). */
export async function reverseEntry(entryId: number, date: string, memo: string): Promise<number> {
  const lines = await db.select().from(journalLines).where(and(eq(journalLines.orgId, currentOrgId()), eq(journalLines.entryId, entryId)));
  const [src] = await db.select().from(journalEntries).where(and(eq(journalEntries.orgId, currentOrgId()), eq(journalEntries.id, entryId))).limit(1);
  return postEntry({
    date,
    memo,
    sourceType: `${src?.sourceType ?? "unknown"}_reversal`,
    sourceId: src?.sourceId ?? undefined,
    reversalOfId: entryId,
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debitCents: l.creditCents,
      creditCents: l.debitCents,
      contactId: l.contactId,
    })),
  });
}

async function getDocWithLines(docId: number) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, docId))).limit(1);
  if (!doc) throw new Error(`Document ${docId} not found`);
  const lines = await db
    .select()
    .from(documentLines)
    .where(and(eq(documentLines.orgId, currentOrgId()), eq(documentLines.documentId, docId)));
  return { doc, lines };
}

/** Invoice: DR AR gross · CR Sales net + VAT Output; FIFO COGS for tracked
 *  items, or (for a kit with a Bill of Materials) FIFO COGS of its
 *  components + a separate Production Waste line for scrap. */
export async function postInvoice(docId: number): Promise<number> {
  const { doc, lines } = await getDocWithLines(docId);

  const [orgRow] = await db.select().from(orgTable).where(eq(orgTable.id, currentOrgId())).limit(1);
  if (orgRow?.blockInsufficientStock) {
    const shortfalls = await checkStockAvailability(
      lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId!, qty: l.qty, warehouseId: l.warehouseId ?? undefined }))
    );
    if (shortfalls.length > 0) {
      const detail = shortfalls.map((s) => `${s.itemName}: need ${s.requiredQty}, only ${s.availableQty} in stock`).join("; ");
      throw new Error(`Not enough stock to complete this sale — ${detail}`);
    }
  }

  const post: PostLine[] = [
    {
      accountId: await acct(SYS.AR),
      debitCents: doc.totalCents,
      contactId: doc.contactId,
      memo: doc.number,
    },
  ];
  for (const l of lines) {
    post.push({
      accountId: l.accountId ?? (await acct(SYS.SALES)),
      creditCents: l.netCents,
      memo: l.description,
      costCenterId: l.costCenterId,
    });
    if (l.taxCents > 0) {
      post.push({ accountId: await acct(SYS.VAT_OUTPUT), creditCents: l.taxCents });
    }
    // FIFO cost of goods for inventory-tracked items (or a kit's components)
    if (l.itemId) {
      const [item] = await db.select().from(items).where(and(eq(items.orgId, currentOrgId()), eq(items.id, l.itemId))).limit(1);
      const { cogsCents, wasteCents, bomBreakdown } = await consumeForSale(l.itemId, l.qty, l.warehouseId ?? undefined);
      // Plain (non-kit) items only actually consumed stock when trackInventory
      // is on — consumeForSale still ran consumeFifo unconditionally above for
      // simplicity, so undo a non-tracked plain item's phantom "consumption"
      // by simply not posting/persisting it (its FIFO call was a no-op: it
      // has no lots, so cost comes back 0 either way).
      if (bomBreakdown || item?.trackInventory) {
        if (cogsCents > 0) {
          post.push({ accountId: await acct(SYS.COGS), debitCents: cogsCents, memo: l.description });
        }
        if (wasteCents > 0) {
          post.push({ accountId: await ensureAccountId(SYS.PRODUCTION_WASTE, "Production Waste", "expense", "other_expense"), debitCents: wasteCents, memo: `Waste — ${l.description}` });
        }
        if (cogsCents + wasteCents > 0) {
          post.push({ accountId: await acct(SYS.INVENTORY), creditCents: cogsCents + wasteCents });
        }
        await db.update(documentLines).set({
          cogsCents,
          bomConsumptionJson: bomBreakdown ? JSON.stringify(bomBreakdown) : null,
        }).where(and(eq(documentLines.orgId, currentOrgId()), eq(documentLines.id, l.id)));
      }
    }
  }
  const entryId = await postEntry({
    date: doc.date,
    memo: `Invoice ${doc.number}`,
    sourceType: "invoice",
    sourceId: doc.id,
    lines: post,
  });
  await db
    .update(documents)
    .set({ journalEntryId: entryId, status: "open" })
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, doc.id)));
  return entryId;
}

/** Credit note: DR Sales + VAT Output · CR AR. (No stock return in v1.) */
export async function postCreditNote(docId: number): Promise<number> {
  const { doc, lines } = await getDocWithLines(docId);
  const post: PostLine[] = [
    {
      accountId: await acct(SYS.AR),
      creditCents: doc.totalCents,
      contactId: doc.contactId,
      memo: doc.number,
    },
  ];
  for (const l of lines) {
    post.push({ accountId: l.accountId ?? (await acct(SYS.SALES)), debitCents: l.netCents, costCenterId: l.costCenterId });
    if (l.taxCents > 0) post.push({ accountId: await acct(SYS.VAT_OUTPUT), debitCents: l.taxCents });
  }
  const entryId = await postEntry({
    date: doc.date,
    memo: `Credit note ${doc.number}`,
    sourceType: "credit_note",
    sourceId: doc.id,
    lines: post,
  });
  await db
    .update(documents)
    .set({ journalEntryId: entryId, status: "open" })
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, doc.id)));

  // If this credit note was raised against a specific invoice, apply it to that
  // invoice's balance due — kept in creditedCents (separate from paidCents, which
  // represents actual cash received) so the invoice's own status/balance-due
  // display and every list/report using it stay in sync with the credit note,
  // without inflating "cash collected" figures.
  if (doc.sourceDocId) {
    const [inv] = await db
      .update(documents)
      .set({ creditedCents: sql`${documents.creditedCents} + ${doc.totalCents}` })
      .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, doc.sourceDocId), eq(documents.type, "invoice")))
      .returning();
    if (inv && !["draft", "void"].includes(inv.status)) {
      const remaining = inv.totalCents - inv.paidCents - inv.creditedCents;
      const status = remaining <= 0 ? "paid" : inv.paidCents > 0 || inv.creditedCents > 0 ? "partial" : "open";
      if (inv.status !== status) {
        await db.update(documents).set({ status }).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, inv.id)));
      }
      if (status === "paid" && inv.status !== "paid" && inv.projectId) {
        await advanceProjectStatus(currentOrgId(), inv.projectId, "completed", "invoice paid in full");
      }
    }
  }
  return entryId;
}

/** Bill: DR expense/inventory net + VAT Input · CR AP. Creates FIFO lots. */
export async function postBill(docId: number): Promise<number> {
  const { doc, lines } = await getDocWithLines(docId);
  const post: PostLine[] = [];
  let vatInput = 0;
  for (const l of lines) {
    let debitAccount = l.accountId ?? (await acct("6900"));
    if (l.itemId) {
      const [item] = await db.select().from(items).where(and(eq(items.orgId, currentOrgId()), eq(items.id, l.itemId))).limit(1);
      if (item?.trackInventory) {
        debitAccount = await acct(SYS.INVENTORY);
        await addLot({
          itemId: l.itemId,
          date: doc.date,
          qty: l.qty,
          unitCostCents: l.qty > 0 ? Math.round(l.netCents / l.qty) : 0,
          sourceType: "bill",
          sourceId: doc.id,
          warehouseId: l.warehouseId ?? undefined,
        });
        // The line's own accountId can carry a category the user picked in
        // the editor (or a stale one from before this override existed) that
        // has nothing to do with where the money actually posts — spend-by-
        // category reports read documentLines.accountId directly, so a
        // mismatch here silently misreports Inventory Asset spend as
        // whatever category was selected. Keep it truthful.
        if (l.accountId !== debitAccount) {
          await db.update(documentLines).set({ accountId: debitAccount }).where(and(eq(documentLines.orgId, currentOrgId()), eq(documentLines.id, l.id)));
        }
      }
    }
    post.push({ accountId: debitAccount, debitCents: l.netCents, memo: l.description, costCenterId: l.costCenterId });
    vatInput += l.taxCents;
  }
  if (vatInput > 0) post.push({ accountId: await acct(SYS.VAT_INPUT), debitCents: vatInput });
  post.push({
    accountId: await acct(SYS.AP),
    creditCents: doc.totalCents,
    contactId: doc.contactId,
    memo: doc.number,
  });
  const entryId = await postEntry({
    date: doc.date,
    memo: `Bill ${doc.number}`,
    sourceType: "bill",
    sourceId: doc.id,
    lines: post,
  });
  await db
    .update(documents)
    .set({ journalEntryId: entryId, status: "open" })
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, doc.id)));
  return entryId;
}

/** Direct expense: DR expense net + VAT Input · CR bank/cash. Immediately paid. */
export async function postExpense(docId: number): Promise<number> {
  const { doc, lines } = await getDocWithLines(docId);
  if (!doc.paidFromBankAccountId) throw new Error("Expense needs a paid-from account");
  const [bank] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.orgId, currentOrgId()), eq(bankAccounts.id, Number(doc.paidFromBankAccountId))))
    .limit(1);
  if (!bank) throw new Error("Bank account not found");

  const post: PostLine[] = [];
  let vatInput = 0;
  for (const l of lines) {
    post.push({
      accountId: l.accountId ?? (await acct("6900")),
      debitCents: l.netCents,
      memo: l.description,
      costCenterId: l.costCenterId,
    });
    vatInput += l.taxCents;
  }
  if (vatInput > 0) post.push({ accountId: await acct(SYS.VAT_INPUT), debitCents: vatInput });
  post.push({ accountId: bank.accountId, creditCents: doc.totalCents, memo: doc.number });

  const entryId = await postEntry({
    date: doc.date,
    memo: `Expense ${doc.number}`,
    sourceType: "expense",
    sourceId: doc.id,
    lines: post,
  });
  await db
    .update(documents)
    .set({ journalEntryId: entryId, status: "paid", paidCents: doc.totalCents })
    .where(eq(documents.id, doc.id));

  // Mirror into the bank register so reconciliation sees this outflow.
  await mirrorBankTxn({
    bankAccountId: bank.id,
    date: doc.date,
    description: `Expense ${doc.number}`,
    amountCents: -doc.totalCents,
    journalEntryId: entryId,
    externalRef: `exp:${doc.id}`,
  });

  // A direct expense has no separate "payment method" field of its own —
  // it's paid straight from whichever account was picked — so the routing
  // check is purely on that account: an M-Pesa till the org has flagged as
  // settling through Kopo Kopo (org.mpesaTillGatewayId) really does incur
  // this fee on every transaction, same as it does for bills/payroll paid
  // the same way. Without this, expenses paid from that till silently never
  // recorded the deduction the statement actually shows.
  if (await isKopoKopoRouted("", bank)) {
    await postKopoKopoFee({
      bankId: bank.id,
      bankAccountId: bank.accountId,
      date: doc.date,
      sourceType: "expense",
      sourceId: doc.id,
      memo: `Expense ${doc.number}`,
    });
  }

  return entryId;
}

/**
 * Mirror a ledger bank movement into the bank register (bank_transactions) so
 * reconciliation sees every line the real statement will show. Idempotent via
 * externalRef. Rows arrive already booked (status "categorized",
 * journalEntryId set) — they are tickable in a reconciliation but never appear
 * in the "needs categorizing" queue.
 */
export async function mirrorBankTxn(params: {
  bankAccountId: number;
  date: string;
  description: string;
  amountCents: number; // signed: + money in, − money out
  journalEntryId: number;
  externalRef: string;
}) {
  const orgId = currentOrgId();
  const [existing] = await db
    .select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(and(eq(bankTransactions.orgId, orgId), eq(bankTransactions.externalRef, params.externalRef)))
    .limit(1);
  if (existing) return;
  await db.insert(bankTransactions).values({
    orgId,
    bankAccountId: params.bankAccountId,
    date: params.date,
    description: params.description,
    amountCents: params.amountCents,
    status: "categorized",
    journalEntryId: params.journalEntryId,
    externalRef: params.externalRef,
    createdAt: nowISO(),
  });
}

/** Flat per-transaction fee Kopo Kopo/M-Pesa-till-via-Kopo-Kopo charges,
 *  deducted from the org's own bank statement on every single payment that
 *  moves through it — in or out — regardless of the payment's own amount. */
const KOPOKOPO_FEE_CENTS = 5000;

/** True when a payment actually rode over Kopo Kopo and so really did incur
 *  the flat fee: either it's tagged method "kopokopo" directly (gateway
 *  payments/payouts), or it landed in an M-Pesa till the org has flagged as
 *  settling through Kopo Kopo (org.mpesaTillGatewayId) even when recorded
 *  manually/via CSV with method "mpesa". */
export async function isKopoKopoRouted(method: string, bank: { kind: string } | null): Promise<boolean> {
  if (method === "kopokopo") return true;
  if (!bank || bank.kind !== "mpesa") return false;
  const [orgRow] = await db.select({ mpesaTillGatewayId: orgTable.mpesaTillGatewayId }).from(orgTable).where(eq(orgTable.id, currentOrgId())).limit(1);
  return orgRow?.mpesaTillGatewayId === "kopokopo";
}

/** Posts the flat Kopo Kopo transaction fee against whichever bank account
 *  actually moved the money — DR the fee expense, CR the bank (a real
 *  extra deduction the statement will show either way, in or out). */
export async function postKopoKopoFee(params: { bankId: number; bankAccountId: number; date: string; sourceType: string; sourceId: number; memo: string }) {
  const feeAccountId = await ensureAccountId(SYS.KOPOKOPO_FEE, "Kopo Kopo Transaction Fees", "expense", "expense");
  const entryId = await postEntry({
    date: params.date,
    memo: `Kopo Kopo transaction fee — ${params.memo}`,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    lines: [
      { accountId: feeAccountId, debitCents: KOPOKOPO_FEE_CENTS },
      { accountId: params.bankAccountId, creditCents: KOPOKOPO_FEE_CENTS },
    ],
  });
  await mirrorBankTxn({
    bankAccountId: params.bankId,
    date: params.date,
    description: `Kopo Kopo transaction fee · ${params.memo}`,
    amountCents: -KOPOKOPO_FEE_CENTS,
    journalEntryId: entryId,
    externalRef: `kkfee:${params.sourceType}:${params.sourceId}`,
  });
}

/**
 * Customer payment: DR bank (net received) + WHT Receivable (withheld) · CR AR (gross).
 * Vendor payment: DR AP · CR bank.
 * Updates the document's paid amount and status.
 */
export async function postPayment(paymentId: number): Promise<number> {
  const [p] = await db.select().from(paymentsTable).where(and(eq(paymentsTable.orgId, currentOrgId()), eq(paymentsTable.id, paymentId))).limit(1);
  if (!p) throw new Error("Payment not found");
  const bank = p.bankAccountId
    ? (await db.select().from(bankAccounts).where(and(eq(bankAccounts.orgId, currentOrgId()), eq(bankAccounts.id, p.bankAccountId))).limit(1))[0]
    : null;
  const bankCoaId = bank ? bank.accountId : await acct(SYS.UNDEPOSITED);

  let lines: PostLine[];
  if (p.direction === "in") {
    lines = [
      { accountId: bankCoaId, debitCents: p.amountCents - p.whtCents, memo: p.reference ?? p.number },
      ...(p.whtCents > 0
        ? [
            {
              accountId: await acct(SYS.WHT_RECEIVABLE),
              debitCents: p.whtCents,
              memo: "WHT withheld by customer",
            },
          ]
        : []),
      { accountId: await acct(SYS.AR), creditCents: p.amountCents, contactId: p.contactId },
    ];
  } else {
    lines = [
      { accountId: await acct(SYS.AP), debitCents: p.amountCents, contactId: p.contactId },
      { accountId: bankCoaId, creditCents: p.amountCents, memo: p.reference ?? p.number },
    ];
  }

  const entryId = await postEntry({
    date: p.date,
    memo: `Payment ${p.number}`,
    sourceType: p.direction === "in" ? "customer_payment" : "vendor_payment",
    sourceId: p.id,
    lines,
  });
  await db.update(paymentsTable).set({ journalEntryId: entryId }).where(and(eq(paymentsTable.orgId, currentOrgId()), eq(paymentsTable.id, p.id)));

  // Mirror into the bank register so reconciliation sees this movement.
  // Direction "in" hits the bank net of WHT (matches the ledger line above).
  if (bank) {
    await mirrorBankTxn({
      bankAccountId: bank.id,
      date: p.date,
      description:
        p.direction === "in"
          ? `Payment received ${p.number}${p.reference ? ` · ${p.reference}` : ""}`
          : `Payment out ${p.number}${p.reference ? ` · ${p.reference}` : ""}`,
      amountCents: p.direction === "in" ? p.amountCents - p.whtCents : -p.amountCents,
      journalEntryId: entryId,
      externalRef: `pmt:${p.id}`,
    });

    // Kopo Kopo's flat fee only applies to money paid OUT through it (bill/
    // PO/expense-claim payouts) — money received from a customer never
    // incurs it, that's charged on the till side of a completely separate
    // Kopo Kopo account, not this org's. Scoping this to direction "out"
    // corrects an earlier version that wrongly charged it on invoice
    // payments received too.
    if (p.direction === "out" && (await isKopoKopoRouted(p.method, bank))) {
      await postKopoKopoFee({
        bankId: bank.id,
        bankAccountId: bank.accountId,
        date: p.date,
        sourceType: "vendor_payment",
        sourceId: p.id,
        memo: `Payment ${p.number}`,
      });
    }
  }

  if (p.documentId) {
    // Atomic increment — two near-simultaneous payments against the same invoice
    // must not race on a read-then-write of paidCents and lose one payment's
    // contribution to this denormalized field (the ledger itself is unaffected
    // either way; this is the document-level cache used for status/balance-due display).
    const [doc] = await db
      .update(documents)
      .set({ paidCents: sql`${documents.paidCents} + ${p.amountCents}` })
      .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, p.documentId)))
      .returning();
    if (doc) {
      const status = doc.paidCents + doc.creditedCents >= doc.totalCents ? "paid" : "partial";
      if (doc.status !== status) {
        await db.update(documents).set({ status }).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, doc.id)));
      }
      // A customer invoice reaching fully paid is a real "this event's money
      // is settled" signal — advance the project the same way a quote being
      // sent/accepted already does. Forward-only, so an earlier invoice
      // paying off after the project is already completed is a no-op.
      if (status === "paid" && doc.type === "invoice" && doc.projectId) {
        await advanceProjectStatus(currentOrgId(), doc.projectId, "completed", "invoice paid in full");
      }
    }
  }
  return entryId;
}

/** Void a posted document: post reversal, restore/undo any FIFO stock movement, mark void. */
export async function voidDocument(docId: number, date: string): Promise<void> {
  const orgId = currentOrgId();
  const [doc] = await db.select().from(documents).where(and(eq(documents.orgId, orgId), eq(documents.id, docId))).limit(1);
  if (!doc) throw new Error("Document not found");

  // A void reverses the document's *entire* original journal entry. If a
  // payment already posted against it, that payment's own debit/credit to
  // AR or AP is untouched by the reversal — so voiding a paid document
  // permanently strands that amount in AR/AP with no document behind it.
  // Payments must be unwound first (the app has no "delete payment" flow
  // yet, so today that means: don't void a document that has money applied).
  if (doc.paidCents > 0 || doc.creditedCents > 0) {
    throw new Error("This document has a payment or credit applied — voiding it now would leave that amount stranded in Accounts Receivable/Payable. Reverse the payment first.");
  }

  if (doc.journalEntryId) {
    // Don't silently break a completed bank reconciliation — the ticked bank
    // register line was matched against this entry; reversing it now would
    // leave that reconciliation's totals no longer reconcilable.
    const [mirrored] = await db
      .select({ reconciliationId: bankTransactions.reconciliationId })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.orgId, orgId), eq(bankTransactions.journalEntryId, doc.journalEntryId)))
      .limit(1);
    if (mirrored?.reconciliationId) {
      throw new Error("This document's bank entry has already been reconciled — reopen that reconciliation before voiding.");
    }
    await reverseEntry(doc.journalEntryId, date, `Void ${doc.number}`);
  }

  // Undo the FIFO stock movement so stock-on-hand/valuation reports don't
  // permanently disagree with the reversed GL Inventory account.
  if (doc.type === "invoice") {
    const { lines } = await getDocWithLines(docId);
    for (const l of lines) {
      if (l.itemId && l.cogsCents && l.qty > 0) {
        const bomBreakdown: BomComponentConsumption[] | null = l.bomConsumptionJson ? JSON.parse(l.bomConsumptionJson) : null;
        await restoreSaleConsumption(l.itemId, l.qty, date, doc.id, l.warehouseId ?? undefined, bomBreakdown, l.cogsCents);
      }
    }
  } else if (doc.type === "bill") {
    const { lines } = await getDocWithLines(docId);
    for (const l of lines) {
      if (l.itemId) {
        const [item] = await db.select().from(items).where(and(eq(items.orgId, orgId), eq(items.id, l.itemId))).limit(1);
        if (item?.trackInventory && l.qty > 0) {
          await consumeFifo(l.itemId, l.qty, l.warehouseId ?? undefined);
        }
      }
    }
  } else if (doc.type === "credit_note" && doc.sourceDocId && doc.status !== "draft") {
    // A credit note that was posted (issued) applied its total to the source
    // invoice's creditedCents. Voiding it must undo that, or the invoice is
    // left permanently overstated as "credited" against a credit note that
    // no longer exists — this was the exact bug reported: voided credit
    // notes never released their amount, so the invoice's balance stayed
    // wrong forever and re-issuing a correct credit note only compounded it.
    const [inv] = await db
      .update(documents)
      .set({ creditedCents: sql`greatest(${documents.creditedCents} - ${doc.totalCents}, 0)` })
      .where(and(eq(documents.orgId, orgId), eq(documents.id, doc.sourceDocId), eq(documents.type, "invoice")))
      .returning();
    if (inv && !["draft", "void"].includes(inv.status)) {
      const remaining = inv.totalCents - inv.paidCents - inv.creditedCents;
      const status = remaining <= 0 ? "paid" : inv.paidCents > 0 || inv.creditedCents > 0 ? "partial" : "open";
      if (inv.status !== status) {
        await db.update(documents).set({ status }).where(and(eq(documents.orgId, orgId), eq(documents.id, inv.id)));
      }
    }
  }

  await db.update(documents).set({ status: "void" }).where(and(eq(documents.orgId, orgId), eq(documents.id, docId)));
}
