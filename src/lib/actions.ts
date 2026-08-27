"use server";
import crypto from "crypto";
import { getAccess } from "@/lib/access";

import {
  db,
  org,
  contacts,
  deals,
  items,
  documents,
  documentLines,
  payments,
  bankAccounts,
  bankTransactions,
  activities,
  accounts,
  documentAssignments,
  notifications,
  customerGroups,
  contactGroupMemberships,
  itemGroups,
  itemTypes,
  paymentGateways,
  paymentEvents,
  costCenters,
} from "@/db";
import { getGateway } from "@/lib/payments/gateway";
import { notifyAccountantOfPayout } from "@/lib/payout-notify";
import { shortRef } from "@/lib/payments/ref-format";
import { canEditIssuedInvoice } from "@/lib/invoice-edit";
import { eq, and, ne, desc, isNull, sql, inArray } from "drizzle-orm";
import { currentOrgId, withOrg, seedOrgDefaults, orgContext } from "@/lib/org";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { computeDocument, type TaxClass, TAX_CLASSES } from "./tax";
import {
  postInvoice,
  postCreditNote,
  postBill,
  postExpense,
  postPayment,
  postEntry,
  reverseEntry,
  voidDocument,
  acct,
  mirrorBankTxn,
  isKopoKopoRouted,
  postKopoKopoFee,
} from "./posting";
import { addLot, consumeFifo, stockOnHand } from "./inventory";
import { SYS } from "./coa";
import { nowISO, todayISO, fmtKES } from "./money";
import { getTaxDevice } from "./etims";
import { ETIMS_ENABLED } from "./features";
import { getUser } from "./supabase/server";

/** revalidatePath, but safe when called outside a Next request (scripts, tests). */
function revalidatePath(path: string, type?: "page" | "layout") {
  try {
    nextRevalidatePath(path, type);
  } catch {
    /* running outside Next request context */
  }
}

import { getOrg } from "@/lib/org";
import { notifyOrg } from "@/lib/notifications";
import { logAudit } from "./audit";
import { buildBalanceAdjustmentLines } from "./account-balance-adjustments";
import {
  canApproveSpend,
  getApprovalRequestByToken,
  getApprovalRequestAnyState,
  isSpendApprovalType,
  markApprovalTokenUsed,
  sendSpendApprovalSms,
} from "./spend-approvals";

const DOC_MODULE: Record<string, "quotes" | "invoices" | "credit_notes" | "bills" | "purchase_orders" | "expenses"> = {
  quote: "quotes",
  invoice: "invoices",
  credit_note: "credit_notes",
  bill: "bills",
  purchase_order: "purchase_orders",
  expense: "expenses",
};

export type NumberKind = "invoice" | "quote" | "credit_note" | "purchase_order" | "payment";
export async function nextNumber(kind: NumberKind): Promise<string> {
  const o = await getOrg();
  const prefixes: Record<NumberKind, string> = {
    invoice: o.invoicePrefix,
    quote: "QT-",
    credit_note: "CN-",
    purchase_order: "PO-",
    payment: "PMT-",
  };
  const current: Record<NumberKind, number> = {
    invoice: o.nextInvoiceNo,
    quote: o.nextQuoteNo,
    credit_note: o.nextCreditNoteNo,
    purchase_order: o.nextPoNo,
    payment: o.nextPaymentNo,
  };
  const n = current[kind];
  await db
    .update(org)
    .set({
      nextInvoiceNo: kind === "invoice" ? n + 1 : o.nextInvoiceNo,
      nextQuoteNo: kind === "quote" ? n + 1 : o.nextQuoteNo,
      nextCreditNoteNo: kind === "credit_note" ? n + 1 : o.nextCreditNoteNo,
      nextPoNo: kind === "purchase_order" ? n + 1 : o.nextPoNo,
      nextPaymentNo: kind === "payment" ? n + 1 : o.nextPaymentNo,
    })
    .where(eq(org.id, o.id));
  return `${prefixes[kind]}${String(n).padStart(4, "0")}`;
}

async function nextNumberInTx(kind: NumberKind, tx: any): Promise<string> {
  const [o] = await tx.select().from(org).where(eq(org.id, currentOrgId())).limit(1);
  if (!o) throw new Error("Organization not found");
  const prefixes: Record<NumberKind, string> = {
    invoice: o.invoicePrefix,
    quote: "QT-",
    credit_note: "CN-",
    purchase_order: "PO-",
    payment: "PMT-",
  };
  const current: Record<NumberKind, number> = {
    invoice: o.nextInvoiceNo,
    quote: o.nextQuoteNo,
    credit_note: o.nextCreditNoteNo,
    purchase_order: o.nextPoNo,
    payment: o.nextPaymentNo,
  };
  const n = current[kind];
  await tx
    .update(org)
    .set({
      nextInvoiceNo: kind === "invoice" ? n + 1 : o.nextInvoiceNo,
      nextQuoteNo: kind === "quote" ? n + 1 : o.nextQuoteNo,
      nextCreditNoteNo: kind === "credit_note" ? n + 1 : o.nextCreditNoteNo,
      nextPoNo: kind === "purchase_order" ? n + 1 : o.nextPoNo,
      nextPaymentNo: kind === "payment" ? n + 1 : o.nextPaymentNo,
    })
    .where(eq(org.id, o.id));
  return `${prefixes[kind]}${String(n).padStart(4, "0")}`;
}

/* ---------------- Contacts & CRM ---------------- */

async function _saveContact(data: {
  id?: number;
  kind: string;
  displayName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  kraPin?: string;
  address?: string;
  city?: string;
  notes?: string;
  isWithholdingAgent?: boolean;
  payoutDestinationType?: "phone" | "till" | "paybill" | null;
  payoutDestination?: string | null;
  payoutAccountNumber?: string | null;
  /** One or more customer groups. Required (>=1) for customers; ignored for vendors. */
  groupIds?: number[];
}) {
  const orgId = currentOrgId();
  const o = await getOrg();
  const isCustomer = data.kind === "customer" || data.kind === "both";
  const isVendor = data.kind === "vendor" || data.kind === "both";

  // New vendors must capture payout details at creation — otherwise a bill
  // against them has no destination, and the admin approval link's "Pay" tap
  // silently fails and sends everyone back to the dashboard to enter payment
  // details manually. Only enforced on create so editing an unrelated field
  // on an existing vendor that predates this rule doesn't get blocked.
  if (isVendor && !data.id) {
    if (!data.payoutDestinationType) throw new Error("Select how this vendor gets paid (mobile number, till, or paybill)");
    if (!data.payoutDestination?.trim()) throw new Error("Enter the vendor's payout destination");
    if (data.payoutDestinationType === "paybill" && !data.payoutAccountNumber?.trim()) throw new Error("Enter the paybill account number");
  }

  // Groups apply to customers only; a vendor-only contact never carries any.
  let groupIds = isCustomer ? [...new Set((data.groupIds ?? []).filter(Boolean))] : [];
  if (isCustomer) {
    if (o.customerGroupsEnabled && groupIds.length === 0) throw new Error("Pick at least one customer group");
    if (groupIds.length > 0) {
      const valid = await db
        .select({ id: customerGroups.id })
        .from(customerGroups)
        .where(and(eq(customerGroups.orgId, orgId), inArray(customerGroups.id, groupIds)));
      if (valid.length !== groupIds.length) throw new Error("One of the chosen groups no longer exists");
    }
  }

  const values = {
    kind: data.kind,
    displayName: data.displayName,
    companyName: data.companyName,
    email: data.email,
    phone: data.phone,
    kraPin: data.kraPin,
    address: data.address,
    city: data.city,
    notes: data.notes,
    isWithholdingAgent: data.isWithholdingAgent,
    payoutDestinationType: data.payoutDestinationType || null,
    payoutDestination: data.payoutDestination || null,
    payoutAccountNumber: data.payoutAccountNumber || null,
    // Keep the legacy single-group column pointed at the first group for any
    // old read path; the membership table below is the source of truth.
    groupId: groupIds[0] ?? null,
  };

  let contactId = data.id;
  if (data.id) {
    await db.update(contacts).set(values).where(and(eq(contacts.orgId, orgId), eq(contacts.id, data.id)));
  } else {
    const [created] = await db.insert(contacts).values({ orgId, ...values, createdAt: nowISO() }).returning();
    contactId = created.id;
  }

  // Replace memberships wholesale — simplest correct way to reconcile add/remove.
  await db.delete(contactGroupMemberships).where(and(eq(contactGroupMemberships.orgId, orgId), eq(contactGroupMemberships.contactId, contactId!)));
  if (groupIds.length > 0) {
    await db.insert(contactGroupMemberships).values(groupIds.map((gid) => ({ orgId, contactId: contactId!, groupId: gid })));
  }

  revalidatePath("/contacts");
  if (data.id) revalidatePath(`/contacts/${data.id}`);
}

async function _addActivity(contactId: number, kind: string, content: string) {
  await db
    .insert(activities)
    .values({ orgId: currentOrgId(), contactId, kind, content, date: todayISO(), createdAt: nowISO() });
  revalidatePath(`/contacts/${contactId}`);
}

async function _saveDeal(data: {
  id?: number;
  contactId: number;
  title: string;
  amountCents: number;
  stage: string;
  expectedClose?: string;
  notes?: string;
}) {
  if (data.id) {
    await db
      .update(deals)
      .set({ ...data, id: undefined, updatedAt: nowISO() })
      .where(and(eq(deals.orgId, currentOrgId()), eq(deals.id, data.id)));
  } else {
    await db.insert(deals).values({ orgId: currentOrgId(), ...data, createdAt: nowISO(), updatedAt: nowISO() });
  }
  revalidatePath("/pipeline");
}

async function validateItemGroup(orgId: number, itemGroupId: number | null | undefined, kind?: string) {
  const o = await getOrg();
  const groupId = itemGroupId ?? null;

  // A group is only required when the org has groups enabled AND this
  // item's type says group is mandatory. An unrecognized/missing type
  // (shouldn't normally happen — the form only offers real types) falls
  // back to "mandatory", the org-level default, rather than silently
  // waiving the requirement.
  let groupMandatory = true;
  if (kind) {
    const [t] = await db
      .select({ isGroupMandatory: itemTypes.isGroupMandatory })
      .from(itemTypes)
      .where(and(eq(itemTypes.orgId, orgId), eq(itemTypes.name, kind)))
      .limit(1);
    if (t) groupMandatory = t.isGroupMandatory;
  }

  if (o.itemGroupsEnabled && groupMandatory && !groupId) {
    throw new Error("Pick an item group");
  }
  if (groupId) {
    const [group] = await db
      .select({ id: itemGroups.id, appliesTo: itemGroups.appliesTo, name: itemGroups.name })
      .from(itemGroups)
      .where(and(eq(itemGroups.orgId, orgId), eq(itemGroups.id, groupId)))
      .limit(1);
    if (!group) throw new Error("The chosen item group no longer exists");
    if (kind && group.appliesTo !== "both" && group.appliesTo !== kind) {
      throw new Error(`"${group.name}" is a ${group.appliesTo}-only group and can't be used for a ${kind} item`);
    }
  }
  return groupId;
}

async function _moveDealStage(dealId: number, stage: string) {
  await db.update(deals).set({ stage, updatedAt: nowISO() }).where(and(eq(deals.orgId, currentOrgId()), eq(deals.id, dealId)));
  revalidatePath("/pipeline");
}

/* ---------------- Invoice & Billable Expenses Combination ---------------- */

export async function getInvoiceWithBillableExpenses(docId: number, orgId: number) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, docId)))
    .limit(1);

  if (!doc) return null;

  const lineRows = await db
    .select({ line: documentLines, itemName: items.name })
    .from(documentLines)
    .leftJoin(items, eq(documentLines.itemId, items.id))
    .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, docId)))
    .orderBy(documentLines.position);

  const baseLines = lineRows.map((r) => ({ ...r.line, itemName: r.itemName }));

  if (doc.type !== "invoice") {
    return { doc, lines: baseLines };
  }

  // Find linked expenses/bills for this invoice
  const linkedExpenses = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.orgId, orgId),
        eq(documents.relatedInvoiceId, docId),
        eq(documents.isBillable, true)
      )
    );

  if (linkedExpenses.length === 0) {
    return { doc, lines: baseLines };
  }

  // Get line descriptions for linked expenses
  const expenseIds = linkedExpenses.map((e) => e.id);
  const expenseLines = await db
    .select({ line: documentLines })
    .from(documentLines)
    .where(and(eq(documentLines.orgId, orgId), inArray(documentLines.documentId, expenseIds)));

  const expLinesMap = new Map<number, string[]>();
  for (const el of expenseLines) {
    const arr = expLinesMap.get(el.line.documentId) || [];
    if (el.line.description) arr.push(el.line.description);
    expLinesMap.set(el.line.documentId, arr);
  }

  let additionalSubtotalCents = 0;
  const billableLines = linkedExpenses.map((exp) => {
    const lineDescs = expLinesMap.get(exp.id) || [];
    const expDetail = lineDescs.join("; ") || exp.notes || "Out-of-pocket expense";
    const fullDesc = `Billable Expense (${exp.number}): ${expDetail}`;
    additionalSubtotalCents += exp.totalCents;

    return {
      id: -exp.id,
      orgId,
      documentId: docId,
      itemId: null,
      itemName: "Billable Expense",
      description: fullDesc,
      qty: 1,
      unitPriceCents: exp.totalCents,
      discountPct: 0,
      taxClass: "D_NONVAT",
      taxRateBp: 0,
      netCents: exp.totalCents,
      taxCents: 0,
      grossCents: exp.totalCents,
      customColumnValue: null,
      billedQty: 0,
      isHeading: false,
    };
  });

  const combinedDoc = {
    ...doc,
    subtotalCents: doc.subtotalCents + additionalSubtotalCents,
    totalCents: doc.totalCents + additionalSubtotalCents,
  };

  return {
    doc: combinedDoc,
    lines: [...baseLines, ...billableLines],
  };
}

/* ---------------- Items ---------------- */

async function _saveItem(data: {
  id?: number;
  kind: string;
  itemGroupId?: number | null;
  name: string;
  sku?: string;
  unit: string;
  description?: string;
  salePriceCents: number;
  purchaseCostCents: number;
  taxClass: string;
  trackInventory: boolean;
  reorderLevel: number;
  openingQty?: number;
  openingUnitCostCents?: number;
  measurementType?: "length" | "area" | null;
  /** Default expense/COGS category for this item's bill/expense/PO lines —
   *  auto-fills the line's category when the item is picked, so staff
   *  aren't left staring at "pick a category" for something the item
   *  itself already knows the answer to every single time it's bought. */
  purchaseAccountId?: number | null;
}) {
  const orgId = currentOrgId();
  const itemGroupId = await validateItemGroup(orgId, data.itemGroupId, data.kind);

  // Defense-in-depth: the UI constrains these, but the action itself shouldn't
  // trust client input — a negative price/cost would post reversed debit/credit
  // amounts to the ledger, and an invalid tax class would silently fall through
  // TAX_CLASSES lookups elsewhere.
  data.salePriceCents = Math.max(0, Math.round(data.salePriceCents));
  data.purchaseCostCents = Math.max(0, Math.round(data.purchaseCostCents));
  data.reorderLevel = Math.max(0, data.reorderLevel);
  if (!(data.taxClass in TAX_CLASSES)) data.taxClass = "B16";

  // SKU uniqueness (per org) — a duplicate SKU corrupts SKU-based lookups/reports.
  const sku = data.sku?.trim() || null;
  data.sku = sku ?? undefined;
  if (sku) {
    const dupeConds = [eq(items.orgId, orgId), eq(items.sku, sku)];
    if (data.id) dupeConds.push(ne(items.id, data.id));
    const [dupe] = await db.select({ id: items.id }).from(items).where(and(...dupeConds)).limit(1);
    if (dupe) throw new Error(`SKU "${sku}" is already used by another item`);
  }

  if (data.id) {
    const [existing] = await db.select().from(items).where(and(eq(items.orgId, orgId), eq(items.id, data.id))).limit(1);
    if (existing && existing.trackInventory !== data.trackInventory) {
      // Turning tracking OFF while units are on hand would silently drop
      // that stock from every valuation/aging report, so that's still
      // blocked. Turning tracking ON is safe to allow outright: an item
      // that's never been tracked has no FIFO lots, so onHand is always 0 —
      // there's nothing to lose. The item just starts showing a "Stock
      // Adjust" control (ItemsTable.tsx) to record what's actually on hand.
      if (existing.trackInventory && !data.trackInventory) {
        const onHand = await stockOnHand(data.id);
        if (onHand !== 0) {
          throw new Error(`Can't stop tracking inventory while ${onHand} units are still on hand — adjust stock to zero first`);
        }
      }
    }
  }

  const [salesAcc] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.orgId, currentOrgId()), eq(accounts.code, SYS.SALES)))
    .limit(1);
  let itemId = data.id;
  if (data.id) {
    await db
      .update(items)
      .set({
        kind: data.kind,
        itemGroupId,
        name: data.name,
        sku: data.sku,
        unit: data.unit,
        description: data.description,
        salePriceCents: data.salePriceCents,
        purchaseCostCents: data.purchaseCostCents,
        taxClass: data.taxClass,
        trackInventory: data.trackInventory,
        reorderLevel: data.reorderLevel,
        measurementType: data.measurementType || null,
        purchaseAccountId: data.purchaseAccountId || null,
      })
      .where(and(eq(items.orgId, currentOrgId()), eq(items.id, data.id)));
  } else {
    const [created] = await db
      .insert(items)
      .values({ orgId: currentOrgId(),
        kind: data.kind,
        itemGroupId,
        name: data.name,
        sku: data.sku,
        unit: data.unit,
        description: data.description,
        salePriceCents: data.salePriceCents,
        purchaseCostCents: data.purchaseCostCents,
        taxClass: data.taxClass,
        trackInventory: data.trackInventory,
        reorderLevel: data.reorderLevel,
        measurementType: data.measurementType || null,
        purchaseAccountId: data.purchaseAccountId || null,
        salesAccountId: salesAcc?.id,
      })
      .returning();
    itemId = created.id;
    // Opening stock: FIFO lot + journal (DR Inventory, CR Opening Balance)
    if (data.trackInventory && (data.openingQty ?? 0) > 0) {
      const qty = data.openingQty!;
      const cost = data.openingUnitCostCents ?? data.purchaseCostCents;
      await addLot({ itemId: created.id, date: todayISO(), qty, unitCostCents: cost, sourceType: "opening" });
      const value = Math.round(qty * cost);
      if (value > 0) {
        await postEntry({
          date: todayISO(),
          memo: `Opening stock — ${data.name}`,
          sourceType: "opening_stock",
          sourceId: created.id,
          lines: [
            { accountId: await acct(SYS.INVENTORY), debitCents: value },
            { accountId: await acct(SYS.OPENING_BALANCE), creditCents: value },
          ],
        });
      }
    }
  }
  revalidatePath("/items");
  return itemId!;
}

async function _adjustStock(itemId: number, qtyDelta: number, unitCostCents: number, reason: string, reasonType?: "shrinkage" | "used_in_production") {
  const value = Math.round(Math.abs(qtyDelta) * unitCostCents);
  if (qtyDelta > 0) {
    await addLot({ itemId, date: todayISO(), qty: qtyDelta, unitCostCents, sourceType: "adjustment" });
    // Only post a journal when there's a value to move — a qty-only adjustment
    // (no cost) still tracks stock but has zero ledger effect.
    if (value > 0) {
      await postEntry({
        date: todayISO(),
        memo: `Stock adjustment (+): ${reason}`,
        sourceType: "inventory_adjustment",
        sourceId: itemId,
        lines: [
          { accountId: await acct(SYS.INVENTORY), debitCents: value },
          { accountId: await acct(SYS.INVENTORY_ADJ), creditCents: value },
        ],
      });
    }
  } else if (qtyDelta < 0) {
    const cogs = await consumeFifo(itemId, -qtyDelta);
    if (cogs > 0) {
      // "used_in_production" — material consumed to fulfill a custom job whose
      // sale was invoiced as a generic labor/service line with no item link,
      // so FIFO never auto-consumed it at invoice time. That's a real cost of
      // the sale and belongs in COGS, not Inventory Adjustments (which is
      // meant for shrinkage/damage/count corrections — mixing the two would
      // misstate both). Defaults to shrinkage for backward compatibility with
      // existing callers.
      const debitAccount = reasonType === "used_in_production" ? SYS.COGS : SYS.INVENTORY_ADJ;
      await postEntry({
        date: todayISO(),
        memo: `Stock adjustment (−): ${reason}`,
        sourceType: "inventory_adjustment",
        sourceId: itemId,
        lines: [
          { accountId: await acct(debitAccount), debitCents: cogs },
          { accountId: await acct(SYS.INVENTORY), creditCents: cogs },
        ],
      });
    }
  }
  revalidatePath("/items");
}

/* ---------------- Documents ---------------- */

export interface DocLineInput {
  itemId?: number | null;
  description: string;
  qty: number;
  unitPriceCents: number;
  discountPct: number;
  taxClass: TaxClass;
  accountId?: number | null;
  customColumnValue?: string | null;
  costCenterId?: number | null;
  warehouseId?: number | null;
  /** Section heading row — see documentLines.isHeading in schema.ts. */
  isHeading?: boolean;
}

async function _saveDocument(data: {
  id?: number;
  type: "quote" | "invoice" | "credit_note" | "bill" | "purchase_order" | "expense";
  contactId?: number | null;
  date: string;
  dueDate?: string | null;
  taxInclusive: boolean;
  notes?: string;
  billNumber?: string; // vendor's own number for bills
  paidFromBankAccountId?: number | null;
  /** Bills only — where the vendor gets paid, captured up front so a remote
   *  (no-login SMS link) approval can also pay it immediately. */
  payoutDestination?: string | null;
  payoutDestinationType?: "phone" | "till" | "paybill" | null;
  payoutAccountNumber?: string | null;
  /** Expense/bill cost attribution — the customer the cost was incurred for. */
  customerContactId?: number | null;
  /** Invoice this cost was rebilled on. Must belong to customerContactId. */
  relatedInvoiceId?: number | null;
  isBillable?: boolean;
  /** Which event this document belongs to — so it shows up both in the
   *  main quotes/invoices/expenses lists and inside that project. */
  projectId?: number | null;
  assignedMemberIds?: number[];
  isTemplate?: boolean;
  saveAsTemplate?: boolean;
  createdByName?: string;
  createdByRole?: string;
  /** Credit notes only — the invoice this credit note is against, tagged
   *  for lineage (same field _createCreditNoteFromInvoice sets when it
   *  copies an invoice's lines wholesale) even when the credit note is
   *  built freehand for a partial amount instead. Only applied on create. */
  sourceInvoiceId?: number;
  lines: DocLineInput[];
}): Promise<number> {
  // Cost attribution only applies to money going out. Silently drop it on sales
  // documents so a stale client payload can't write a nonsensical link.
  if (data.type !== "expense" && data.type !== "bill") {
    data.customerContactId = null;
    data.relatedInvoiceId = null;
    data.isBillable = false;
  }
  if (data.relatedInvoiceId && !data.customerContactId) {
    throw new Error("Pick the customer before linking an invoice");
  }
  if (data.relatedInvoiceId) {
    // Never trust the client's pairing — verify the invoice is ours, is an
    // invoice, and actually belongs to the customer being tagged.
    const [inv] = await db
      .select({ id: documents.id, contactId: documents.contactId, type: documents.type })
      .from(documents)
      .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, data.relatedInvoiceId)))
      .limit(1);
    if (!inv || inv.type !== "invoice") throw new Error("Linked invoice not found");
    if (inv.contactId !== data.customerContactId) {
      throw new Error("That invoice belongs to a different customer");
    }
  }

  const totals = computeDocument(
    data.lines.map((l) => ({
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      discountPct: l.discountPct,
      taxClass: l.taxClass,
    })),
    data.taxInclusive
  );

  // Editing an issued (non-draft) invoice: previously hard-blocked outright.
  // Now permitted — gated by org.restrictIssuedInvoiceEdit/issuedInvoiceEditRoles
  // — but only while it's still "open" and has zero payments applied; anything
  // with money against it or a reconciled bank entry stays void-and-reissue
  // only, same as before. Reverses the existing posting and FIFO consumption
  // up front (before lines are overwritten below), then re-posts fresh after
  // the transaction commits.
  let repostInvoiceId: number | null = null;
  if (data.id) {
    const [existingPre] = await db.select().from(documents).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, data.id))).limit(1);
    if (existingPre && existingPre.type === "invoice" && existingPre.status !== "draft") {
      if (existingPre.status !== "open" || existingPre.paidCents > 0) {
        throw new Error("Only an open, unpaid issued invoice can be edited — void and reissue for anything else");
      }
      if (ETIMS_ENABLED) {
        throw new Error("Issued invoices can't be edited once fiscally signed — void and reissue instead");
      }
      const editAccess = await getAccess();
      const editOrg = await getOrg();
      if (!canEditIssuedInvoice(editAccess, editOrg)) {
        throw new Error("You don't have permission to edit issued invoices");
      }
      if (existingPre.journalEntryId) {
        const [mirrored] = await db
          .select({ reconciliationId: bankTransactions.reconciliationId })
          .from(bankTransactions)
          .where(and(eq(bankTransactions.orgId, currentOrgId()), eq(bankTransactions.journalEntryId, existingPre.journalEntryId)))
          .limit(1);
        if (mirrored?.reconciliationId) {
          throw new Error("This invoice's bank entry has already been reconciled — void and reissue instead");
        }
        await reverseEntry(existingPre.journalEntryId, todayISO(), `Reversed for edit: ${existingPre.number}`);
      }
      const oldLines = await db.select().from(documentLines).where(eq(documentLines.documentId, data.id));
      for (const l of oldLines) {
        if (l.itemId && l.cogsCents && l.qty > 0) {
          await addLot({
            itemId: l.itemId,
            date: todayISO(),
            qty: l.qty,
            unitCostCents: Math.round(l.cogsCents / l.qty),
            sourceType: "adjustment",
            sourceId: data.id,
            warehouseId: l.warehouseId ?? undefined,
          });
        }
      }
      await db.update(documents).set({ status: "draft" }).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, data.id)));
      repostInvoiceId = data.id;
    }
  }

  const docId = await db.transaction(async (tx) => {
    let savedDocId: number;
    if (data.id) {
      const [existing] = await tx.select().from(documents).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, data.id))).limit(1);
      if (!existing) throw new Error("Document not found");
      const newStatus = existing.status;
      if (existing.type === "quote") {
        if (existing.status !== "draft" && existing.status !== "open") throw new Error("Only draft or open quotes can be edited");
      } else if (existing.type === "invoice") {
        if (existing.status !== "draft") throw new Error("Issued invoices can't be edited — void and reissue instead");
      } else {
        if (existing.status !== "draft") throw new Error("Only drafts can be edited");
      }
      await tx
        .update(documents)
        .set({
          status: newStatus,
          contactId: data.contactId,
          date: data.date,
          dueDate: data.dueDate,
          taxInclusive: data.taxInclusive,
          notes: data.notes,
          subtotalCents: totals.subtotalCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          isTemplate: data.isTemplate || false,
          paidFromBankAccountId: data.paidFromBankAccountId,
          customerContactId: data.customerContactId ?? null,
          relatedInvoiceId: data.relatedInvoiceId ?? null,
          isBillable: data.isBillable ?? false,
          payoutDestination: data.payoutDestination ?? null,
          payoutDestinationType: data.payoutDestinationType ?? null,
          payoutAccountNumber: data.payoutAccountNumber ?? null,
          projectId: data.projectId ?? null,
        })
        .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, data.id)));
      await tx.delete(documentLines).where(eq(documentLines.documentId, data.id));
      savedDocId = data.id;
    } else {
      const number =
        data.type === "bill" || data.type === "expense"
          ? data.billNumber || `${data.type === "bill" ? "BILL" : "EXP"}-${Date.now().toString(36).toUpperCase()}`
          : await nextNumberInTx(data.type as NumberKind, tx);
      const [created] = await tx
        .insert(documents)
        .values({ orgId: currentOrgId(),
          type: data.type,
          number,
          contactId: data.contactId,
          date: data.date,
          dueDate: data.dueDate,
          taxInclusive: data.taxInclusive,
          isTemplate: data.isTemplate || false,
          notes: data.notes,
          subtotalCents: totals.subtotalCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          paidFromBankAccountId: data.paidFromBankAccountId,
          customerContactId: data.customerContactId ?? null,
          relatedInvoiceId: data.relatedInvoiceId ?? null,
          isBillable: data.isBillable ?? false,
          payoutDestination: data.payoutDestination ?? null,
          payoutDestinationType: data.payoutDestinationType ?? null,
          payoutAccountNumber: data.payoutAccountNumber ?? null,
          projectId: data.projectId ?? null,
          createdByName: data.createdByName,
          createdByRole: data.createdByRole,
          createdAt: nowISO(),
        })
        .returning();
      savedDocId = created.id;
    }

    await tx.insert(documentLines).values(
      data.lines.map((l, i) => {
        const t = totals.lines[i];
        return {
          orgId: currentOrgId(),
          documentId: savedDocId,
          itemId: l.itemId,
          description: l.description,
          qty: l.qty,
          unitPriceCents: l.unitPriceCents,
          discountPct: l.discountPct,
          taxClass: l.taxClass,
          taxRateBp: t.taxRateBp,
          netCents: t.netCents,
          taxCents: t.taxCents,
          grossCents: t.grossCents,
          accountId: l.accountId,
          position: i,
          customColumnValue: l.customColumnValue || null,
          costCenterId: l.costCenterId || null,
          warehouseId: l.warehouseId || null,
          isHeading: l.isHeading ?? false,
        };
      })
    );

    if (data.assignedMemberIds) {
      const orgId = currentOrgId();
      await tx.delete(documentAssignments).where(and(eq(documentAssignments.orgId, orgId), eq(documentAssignments.documentId, savedDocId)));
      if (data.assignedMemberIds.length > 0) {
        await tx.insert(documentAssignments).values(
          data.assignedMemberIds.map((memberId) => ({
            orgId,
            documentId: savedDocId,
            memberId,
            createdAt: nowISO(),
          }))
        );

        const assignmentPath: Record<string, string> = {
          quote: "sales/quotes",
          invoice: "sales/invoices",
          credit_note: "sales/credit-notes",
          bill: "purchases/bills",
          expense: "purchases/expenses",
          purchase_order: "purchases/orders",
        };
        await tx.insert(notifications).values(
          data.assignedMemberIds.map((memberId) => ({
            orgId,
            memberId,
            title: "New Assignment",
            body: `You have been assigned to ${data.type} #${savedDocId}`,
            link: `/${assignmentPath[data.type] || "sales/invoices"}/${savedDocId}`,
            createdAt: nowISO(),
          }))
        );
      }
    }

    if (!data.id && data.type === "credit_note" && data.sourceInvoiceId) {
      await tx
        .update(documents)
        .set({ sourceDocId: data.sourceInvoiceId })
        .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, savedDocId)));
    }

    return savedDocId;
  });

  if (repostInvoiceId) {
    // postInvoice sets status back to "open" itself once the fresh entry posts.
    await postInvoice(repostInvoiceId);
  }

  revalidatePath("/sales");
  revalidatePath("/purchases");

  if (data.saveAsTemplate) {
    await _saveDocument({
      ...data,
      id: undefined, // Create a new record
      isTemplate: true,
      saveAsTemplate: false, // Prevent infinite loop
    });
  }

  return docId;
}

/** Issue (post) a draft document. For invoices this also signs via the tax device. */
async function _issueDocument(docId: number) {
  const orgId = currentOrgId();
  // Atomic claim: flips status off "draft" only for the request that gets there
  // first, so two concurrent "Issue" clicks can't both pass the check and both
  // post a journal entry (and, for stocked items, both draw down FIFO stock).
  const [claimed] = await db
    .update(documents)
    .set({ status: "issuing" })
    .where(and(eq(documents.orgId, orgId), eq(documents.id, docId), eq(documents.status, "draft")))
    .returning();
  if (!claimed) throw new Error("Already issued");
  const doc = claimed;

  try {
    await _issueClaimedDocument(doc);
  } catch (e) {
    // Release the claim so the document isn't stuck mid-issue after a failed post.
    await db.update(documents).set({ status: "draft" }).where(and(eq(documents.orgId, orgId), eq(documents.id, docId), eq(documents.status, "issuing")));
    throw e;
  }
}

async function _issueClaimedDocument(doc: typeof documents.$inferSelect) {
  const docId = doc.id;
  switch (doc.type) {
    case "invoice": {
      // KRA eTIMS signing — gated behind ETIMS_ENABLED (off until a real
      // OSCU/reseller integration is in place). When off, no CU number/QR is
      // generated and the eTIMS blocks on views/PDFs stay hidden. See
      // src/lib/features.ts and src/lib/etims.ts — nothing is removed.
      if (ETIMS_ENABLED) {
        const o = await getOrg();
        const buyer = doc.contactId
          ? (await db.select().from(contacts).where(and(eq(contacts.orgId, currentOrgId()), eq(contacts.id, doc.contactId))).limit(1))[0]
          : null;
        const device = getTaxDevice(o.cuSerial);
        const signed = device.sign({
          sellerPin: o.kraPin ?? "P000000000X",
          buyerPin: buyer?.kraPin,
          invoiceNumber: doc.number,
          totalCents: doc.totalCents,
          taxCents: doc.taxCents,
          dateISO: doc.date,
        });
        await db
          .update(documents)
          .set({ cuInvoiceNumber: signed.cuInvoiceNumber, cuSerial: signed.cuSerial, qrUrl: signed.qrUrl })
          .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, docId)));
      }
      await postInvoice(docId);
      break;
    }
    case "credit_note":
      await postCreditNote(docId);
      break;
    case "bill": {
      const o = await getOrg();
      if (o.requireBillApproval) {
        await db.update(documents).set({ status: "pending_approval", approvalNote: null }).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, docId)));
        await notifyOrg(currentOrgId(), ["admin", "accountant"], "Bill awaiting approval", `${doc.number} (${fmtKES(doc.totalCents)}) needs approval before it posts.`, `/purchases/bills/${docId}`);
        await sendSpendApprovalSms(docId).catch(() => null);
        break;
      }
      await postBill(docId);
      break;
    }
    case "expense":
      if ((await getOrg()).requireBillApproval) {
        await db.update(documents).set({ status: "pending_approval", approvalNote: null }).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, docId)));
        await notifyOrg(currentOrgId(), ["admin", "accountant"], "Expense awaiting approval", `${doc.number} (${fmtKES(doc.totalCents)}) needs approval before it posts.`, `/purchases/expenses/${docId}`);
        await sendSpendApprovalSms(docId).catch(() => null);
        break;
      }
      await postExpense(docId);
      break;
    case "quote":
      await db.update(documents).set({ status: "open" }).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, docId)));
      break;
    case "purchase_order":
      await db.update(documents).set({ status: "open" }).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, docId)));
      break;
  }
  revalidatePath("/sales");
  revalidatePath("/purchases");
}

async function _voidDoc(docId: number) {
  await voidDocument(docId, todayISO());
  revalidatePath("/sales");
  revalidatePath("/purchases");
}

async function _markQuote(docId: number, status: "accepted" | "declined") {
  await db.update(documents).set({ status }).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, docId)));
  if (status === "accepted") {
  }
  revalidatePath("/sales");
}

/** Convert an open or accepted quote into a draft invoice. */
async function _convertQuoteToInvoice(quoteId: number): Promise<number> {
  const orgId = currentOrgId();
  // Atomic claim: a double-click (or a second explicit call) on an
  // already-converted quote must not create a second, independent invoice.
  // Both "open" and "accepted" are convertible — this previously excluded
  // "accepted" instead of requiring it, so an accepted quote (the normal,
  // expected case) could never actually be converted; it always failed with
  // "already converted" even on the very first attempt.
  // Captured BEFORE the claim below — .returning() on that UPDATE reflects
  // the row AFTER it's applied (status already "converting"), so reading
  // the restore value from there was a no-op that permanently stranded a
  // quote in "converting" forever the moment anything downstream threw
  // (confirmed live: the same bug in _convertPoToBill left a real PO stuck
  // exactly this way, unrenderable and unbillable, with no way back).
  const [before] = await db.select({ status: documents.status }).from(documents).where(and(eq(documents.orgId, orgId), eq(documents.id, quoteId))).limit(1);
  const originalStatus = before?.status ?? "open";

  const [quote] = await db
    .update(documents)
    .set({ status: "converting" })
    .where(and(eq(documents.orgId, orgId), eq(documents.id, quoteId), eq(documents.type, "quote"), inArray(documents.status, ["open", "accepted"])))
    .returning();
  if (!quote) throw new Error("This quote was already converted to an invoice");
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, quoteId)).orderBy(documentLines.position);
  let invoiceId: number;
  try {
    invoiceId = await _convertQuoteToInvoiceInner(quote, lines);
  } catch (e) {
    // Restore whatever status it actually held (open or accepted) rather than
    // hardcoding "open", which would silently discard an acceptance on failure.
    await db.update(documents).set({ status: originalStatus }).where(and(eq(documents.orgId, orgId), eq(documents.id, quoteId), eq(documents.status, "converting")));
    throw e;
  }
  return invoiceId;
}

async function _convertQuoteToInvoiceInner(quote: typeof documents.$inferSelect, lines: (typeof documentLines.$inferSelect)[]): Promise<number> {
  const invoiceId = await saveDocument({
    type: "invoice",
    contactId: quote.contactId,
    date: todayISO(),
    dueDate: null,
    taxInclusive: quote.taxInclusive,
    notes: quote.notes ?? undefined,
    projectId: quote.projectId,
    lines: lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      discountPct: l.discountPct,
      taxClass: l.taxClass as TaxClass,
      accountId: l.accountId,
      customColumnValue: l.customColumnValue,
      costCenterId: l.costCenterId,
      warehouseId: l.warehouseId,
    })),
  });
  await db
    .update(documents)
    .set({ sourceDocId: quote.id, status: "draft" })
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, invoiceId)));
  // Terminal state — NOT "accepted". Resting a converted quote back at
  // "accepted" put it back in the set the atomic claim above treats as
  // convertible, so a second click (or a retried request) could claim it
  // again and generate a second, independent invoice from the same quote.
  await db.update(documents).set({ status: "converted" }).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, quote.id)));
  return invoiceId;
}

/* ---------------- Payments ---------------- */

async function _recordPayment(data: {
  direction: "in" | "out";
  documentId: number;
  date: string;
  amountCents: number;
  whtCents?: number;
  method: string;
  bankAccountId?: number | null;
  reference?: string;
}) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, data.documentId))).limit(1);
  if (!doc) throw new Error("Document not found");
  const [p] = await db
    .insert(payments)
    .values({ orgId: currentOrgId(),
      number: await nextNumber("payment"),
      direction: data.direction,
      contactId: doc.contactId,
      documentId: data.documentId,
      date: data.date,
      amountCents: data.amountCents,
      whtCents: data.whtCents ?? 0,
      method: data.method,
      bankAccountId: data.bankAccountId,
      reference: data.reference,
      createdAt: nowISO(),
    })
    .returning();
  await postPayment(p.id);
  revalidatePath("/sales");
  revalidatePath("/purchases");
  revalidatePath("/");
  return p.id;
}

/* ---------------- Notifications ---------------- */

export async function getNotifications(memberId: number | null) {
  return withOrg(async () => {
    return db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.orgId, currentOrgId()),
          memberId ? eq(notifications.memberId, memberId) : isNull(notifications.memberId)
        )
      )
      .orderBy(desc(notifications.id))
      .limit(20);
  });
}

export async function markNotificationRead(id: number) {
  return withOrg(async () => {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.orgId, currentOrgId()), eq(notifications.id, id)));
    revalidatePath("/", "layout");
  });
}

export async function markAllNotificationsRead(memberId: number | null) {
  return withOrg(async () => {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.orgId, currentOrgId()),
          memberId ? eq(notifications.memberId, memberId) : isNull(notifications.memberId),
          eq(notifications.isRead, false)
        )
      );
    revalidatePath("/", "layout");
  });
}

/* ---------------- Banking ---------------- */

async function ensureMoneyAccountOpeningBalanceAccess() {
  const access = await getAccess();
  if (!access || (!access.isOwner && !["admin", "accountant"].includes(access.role))) {
    throw new Error("Only admins and accountants can update money account opening balances");
  }
  if (!access.isOwner && !access.perms.has("banking") && !access.perms.has("accountant")) {
    throw new Error("You do not have access to manage money account opening balances");
  }
}

async function _addBankTransaction(data: {
  bankAccountId: number;
  date: string;
  description: string;
  amountCents: number;
}) {
  await db.insert(bankTransactions).values({ orgId: currentOrgId(), ...data, createdAt: nowISO() });
  revalidatePath("/banking");
}

/** Categorize an uncategorized bank line: creates the journal. */
async function _categorizeTransaction(txnId: number, categoryAccountId: number) {
  const orgId = currentOrgId();
  // Atomic claim: only the first request to hit this sees status flip from
  // "uncategorized" — a concurrent double-click or bulk-select overlap on the
  // same row is rejected instead of posting the same bank movement twice.
  const [claimed] = await db
    .update(bankTransactions)
    .set({ status: "categorizing" })
    .where(and(eq(bankTransactions.orgId, orgId), eq(bankTransactions.id, txnId), eq(bankTransactions.status, "uncategorized")))
    .returning();
  if (!claimed) throw new Error("This transaction was already categorized");
  const txn = claimed;
  try {
    const [bank] = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.orgId, currentOrgId()), eq(bankAccounts.id, txn.bankAccountId)))
      .limit(1);
    if (!bank) throw new Error("Bank account not found");
    const amount = Math.abs(txn.amountCents);
    const entryId = await postEntry({
      date: txn.date,
      memo: txn.description,
      sourceType: "bank_txn",
      sourceId: txn.id,
      lines:
        txn.amountCents >= 0
          ? [
              { accountId: bank.accountId, debitCents: amount },
              { accountId: categoryAccountId, creditCents: amount },
            ]
          : [
              { accountId: categoryAccountId, debitCents: amount },
              { accountId: bank.accountId, creditCents: amount },
            ],
    });
    await db
      .update(bankTransactions)
      .set({ status: "categorized", categoryAccountId, journalEntryId: entryId })
      .where(eq(bankTransactions.id, txnId));
    // Learn: remember this description→account choice for future imports
    const { learnRule } = await import("./categorization");
    await learnRule(txn.description, txn.amountCents >= 0 ? "in" : "out", categoryAccountId);
    revalidatePath("/banking");
  } catch (e) {
    // Release the claim so the transaction isn't stuck "categorizing" forever after a failed post.
    await db.update(bankTransactions).set({ status: "uncategorized" }).where(and(eq(bankTransactions.id, txnId), eq(bankTransactions.status, "categorizing")));
    throw e;
  }
}

async function _bulkCategorizeTransactions(updates: { txnId: number; categoryAccountId: number }[]) {
  for (const { txnId, categoryAccountId } of updates) {
    await _categorizeTransaction(txnId, categoryAccountId);
  }
  revalidatePath("/banking");
}

async function _setMoneyAccountOpeningBalance(data: {
  bankAccountId: number;
  openingBalanceCents: number;
  openingBalanceDate: string;
  memo?: string;
}) {
  await ensureMoneyAccountOpeningBalanceAccess();
  const orgId = currentOrgId();
  const [bank] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.id, data.bankAccountId)))
    .limit(1);
  if (!bank) throw new Error("Money account not found");
  if (!["bank", "mpesa"].includes(bank.kind)) throw new Error("Opening balances can only be edited for bank and M-Pesa accounts");
  if (!data.openingBalanceDate) throw new Error("Opening balance date is required");

  const openingBalanceAccountId = await acct(SYS.OPENING_BALANCE);
  if (bank.openingBalanceEntryId) {
    await reverseEntry(
      bank.openingBalanceEntryId,
      bank.openingBalanceDate || data.openingBalanceDate,
      `Reverse opening balance for ${bank.name}`
    );
  }

  let openingEntryId: number | null = null;
  if (data.openingBalanceCents !== 0) {
    openingEntryId = await postEntry({
      date: data.openingBalanceDate,
      memo: (data.memo || `Opening balance for ${bank.name}`).trim(),
      sourceType: "bank_opening_balance",
      sourceId: bank.id,
      lines: buildBalanceAdjustmentLines({
        accountId: bank.accountId,
        accountType: "asset",
        offsetAccountId: openingBalanceAccountId,
        deltaCents: data.openingBalanceCents,
      }).map((line) => ({ ...line, memo: bank.name })),
    });
  }

  const externalRef = `opening_balance:${bank.id}`;
  const [existingTxn] = await db
    .select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(and(eq(bankTransactions.orgId, orgId), eq(bankTransactions.externalRef, externalRef)))
    .limit(1);

  if (openingEntryId) {
    if (existingTxn) {
      await db
        .update(bankTransactions)
        .set({
          date: data.openingBalanceDate,
          description: `Opening balance · ${bank.name}`,
          amountCents: data.openingBalanceCents,
          status: "categorized",
          categoryAccountId: openingBalanceAccountId,
          journalEntryId: openingEntryId,
        })
        .where(eq(bankTransactions.id, existingTxn.id));
    } else {
      await db.insert(bankTransactions).values({
        orgId,
        bankAccountId: bank.id,
        date: data.openingBalanceDate,
        description: `Opening balance · ${bank.name}`,
        amountCents: data.openingBalanceCents,
        status: "categorized",
        categoryAccountId: openingBalanceAccountId,
        journalEntryId: openingEntryId,
        externalRef,
        createdAt: nowISO(),
      });
    }
  } else if (existingTxn) {
    await db.delete(bankTransactions).where(eq(bankTransactions.id, existingTxn.id));
  }

  await db
    .update(bankAccounts)
    .set({
      openingBalanceCents: data.openingBalanceCents,
      openingBalanceDate: data.openingBalanceCents !== 0 ? data.openingBalanceDate : null,
      openingBalanceEntryId: openingEntryId,
    })
    .where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.id, bank.id)));

  revalidatePath("/banking");
  await logAudit({
    action: "update",
    module: "banking",
    recordId: bank.id,
    recordLabel: bank.name,
    detail:
      data.openingBalanceCents === 0
        ? "Cleared opening balance"
        : `Set opening balance to ${fmtKES(data.openingBalanceCents)} on ${data.openingBalanceDate}`,
  });
}

async function ensureContactOpeningBalanceAccess() {
  const access = await getAccess();
  if (!access || (!access.isOwner && !["admin", "accountant"].includes(access.role))) {
    throw new Error("Only admins and accountants can set a customer/vendor's brought-forward balance");
  }
}

/** Balance brought forward from a previous system (e.g. an old CRM), as of a
 *  chosen date. Posts DR/CR Accounts Receivable or Payable against "Opening
 *  Balance Adjustments" — never against Sales/COGS — so it never inflates
 *  current-period revenue, and mirrors _setMoneyAccountOpeningBalance's
 *  reversible, re-editable pattern (edit again = reverse old entry, post new
 *  one). Tags the AR/AP line with contactId so it's traceable per-contact
 *  and shows up correctly in that contact's statement/ledger drill-down. */
async function _setContactOpeningBalance(data: {
  contactId: number;
  openingBalanceCents: number;
  openingBalanceDate: string;
  memo?: string;
}) {
  await ensureContactOpeningBalanceAccess();
  const orgId = currentOrgId();
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, orgId), eq(contacts.id, data.contactId)))
    .limit(1);
  if (!contact) throw new Error("Contact not found");
  if (!data.openingBalanceDate) throw new Error("Opening balance date is required");

  const isPayable = contact.kind === "vendor";
  const subledgerAccountId = await acct(isPayable ? SYS.AP : SYS.AR);
  const openingBalanceAccountId = await acct(SYS.OPENING_BALANCE);

  if (contact.openingBalanceEntryId) {
    await reverseEntry(
      contact.openingBalanceEntryId,
      contact.openingBalanceDate || data.openingBalanceDate,
      `Reverse opening balance for ${contact.displayName}`
    );
  }

  let openingEntryId: number | null = null;
  if (data.openingBalanceCents !== 0) {
    openingEntryId = await postEntry({
      date: data.openingBalanceDate,
      memo: (data.memo || `Balance brought forward for ${contact.displayName}`).trim(),
      sourceType: "contact_opening_balance",
      sourceId: contact.id,
      lines: buildBalanceAdjustmentLines({
        accountId: subledgerAccountId,
        accountType: isPayable ? "liability" : "asset",
        offsetAccountId: openingBalanceAccountId,
        deltaCents: data.openingBalanceCents,
      }).map((line) => (line.accountId === subledgerAccountId ? { ...line, contactId: contact.id, memo: contact.displayName } : line)),
    });
  }

  await db
    .update(contacts)
    .set({
      openingBalanceCents: data.openingBalanceCents,
      openingBalanceDate: data.openingBalanceCents !== 0 ? data.openingBalanceDate : null,
      openingBalanceEntryId: openingEntryId,
    })
    .where(and(eq(contacts.orgId, orgId), eq(contacts.id, contact.id)));

  revalidatePath(`/contacts/${contact.id}`);
  await logAudit({
    action: "update",
    module: "contacts",
    recordId: contact.id,
    recordLabel: contact.displayName,
    detail:
      data.openingBalanceCents === 0
        ? "Cleared brought-forward balance"
        : `Set brought-forward balance to ${fmtKES(data.openingBalanceCents)} on ${data.openingBalanceDate}`,
  });
}

export async function setContactOpeningBalanceAction(
  data: Parameters<typeof _setContactOpeningBalance>[0]
) {
  return withOrg(async () => {
    await _setContactOpeningBalance(data);
  });
}

/**
 * Records a payment against a contact's balance brought forward (partial or
 * full) — the lump sum itself isn't a document, so it can never be paid off
 * through the normal invoice/bill payment flow. Posts DR bank/CR AR (a
 * customer paying down what they owed) or DR AP/CR bank (paying a vendor
 * down), reduces the tracked openingBalanceCents by exactly what was paid,
 * and records an ordinary `payments` row so it shows up in Payments
 * Received/Made like any other payment — same ledger shape postPayment()
 * already uses for a real invoice/bill, just without a documentId.
 */
async function _payContactOpeningBalance(data: {
  contactId: number;
  amountCents: number;
  date: string;
  method: string;
  bankAccountId?: number | null;
  reference?: string;
}): Promise<number> {
  const access = await getAccess();
  if (!access || (!access.isOwner && !["admin", "accountant"].includes(access.role))) {
    throw new Error("Only admins and accountants can record a payment against a brought-forward balance");
  }
  const orgId = currentOrgId();
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.id, data.contactId))).limit(1);
  if (!contact) throw new Error("Contact not found");
  if (!Number.isInteger(data.amountCents) || data.amountCents <= 0) throw new Error("Enter an amount greater than zero");
  if (data.amountCents > contact.openingBalanceCents) {
    throw new Error(`Amount exceeds the remaining brought-forward balance (${fmtKES(contact.openingBalanceCents)})`);
  }

  const isPayable = contact.kind === "vendor";
  const bank = data.bankAccountId
    ? (await db.select().from(bankAccounts).where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.id, data.bankAccountId))).limit(1))[0]
    : null;
  const bankCoaId = bank ? bank.accountId : await acct(SYS.UNDEPOSITED);
  const subledgerAccountId = await acct(isPayable ? SYS.AP : SYS.AR);

  const entryId = await postEntry({
    date: data.date,
    memo: `Balance brought forward ${isPayable ? "paid" : "received"} · ${contact.displayName}`,
    sourceType: "contact_opening_balance_payment",
    sourceId: contact.id,
    lines: isPayable
      ? [
          { accountId: subledgerAccountId, debitCents: data.amountCents, contactId: contact.id },
          { accountId: bankCoaId, creditCents: data.amountCents },
        ]
      : [
          { accountId: bankCoaId, debitCents: data.amountCents },
          { accountId: subledgerAccountId, creditCents: data.amountCents, contactId: contact.id },
        ],
  });

  if (bank) {
    await mirrorBankTxn({
      bankAccountId: bank.id,
      date: data.date,
      description: `Balance b/f ${isPayable ? "paid" : "received"} · ${contact.displayName}${data.reference ? ` · ${data.reference}` : ""}`,
      amountCents: isPayable ? -data.amountCents : data.amountCents,
      journalEntryId: entryId,
      externalRef: `ob_pmt:${entryId}`,
    });
    if (isPayable && (await isKopoKopoRouted(data.method, bank))) {
      await postKopoKopoFee({
        bankId: bank.id,
        bankAccountId: bank.accountId,
        date: data.date,
        sourceType: "contact_opening_balance_payment",
        sourceId: entryId,
        memo: `Balance b/f paid · ${contact.displayName}`,
      });
    }
  }

  const newOpeningBalanceCents = contact.openingBalanceCents - data.amountCents;
  await db
    .update(contacts)
    .set({
      openingBalanceCents: newOpeningBalanceCents,
      ...(newOpeningBalanceCents === 0 ? { openingBalanceDate: null } : {}),
    })
    .where(and(eq(contacts.orgId, orgId), eq(contacts.id, contact.id)));

  await db.insert(payments).values({
    orgId,
    number: await nextNumber("payment"),
    direction: isPayable ? "out" : "in",
    contactId: contact.id,
    documentId: null,
    date: data.date,
    amountCents: data.amountCents,
    method: data.method,
    bankAccountId: data.bankAccountId ?? null,
    reference: data.reference,
    journalEntryId: entryId,
    createdAt: nowISO(),
  });

  await logAudit({
    action: "update",
    module: "contacts",
    recordId: contact.id,
    recordLabel: contact.displayName,
    detail: `${isPayable ? "Paid" : "Received"} ${fmtKES(data.amountCents)} against brought-forward balance — ${fmtKES(newOpeningBalanceCents)} remaining`,
  });
  revalidatePath(`/contacts/${contact.id}`);
  revalidatePath("/sales/payments");
  revalidatePath("/");
  return entryId;
}

export async function payContactOpeningBalanceAction(
  data: Parameters<typeof _payContactOpeningBalance>[0]
) {
  return withOrg(() => _payContactOpeningBalance(data));
}

/* ---------------- Manual journals ---------------- */

async function _createManualJournal(data: {
  date: string;
  memo: string;
  lines: { accountId: number; debitCents: number; creditCents: number }[];
}) {
  await postEntry({ date: data.date, memo: data.memo, sourceType: "manual", lines: data.lines });
  revalidatePath("/accountant");
}

/* ---------------- Settings ---------------- */

export async function saveOrg(data: {
  name: string;
  kraPin?: string;
  vatRegistered: boolean;
  address?: string;
  phone?: string;
  email?: string;
  invoicePrefix: string;
  logoUrl?: string;
  brandColor?: string;
}) {
  const user = await getUser();
  if (!user) throw new Error("Not authenticated");
  await db.update(org).set(data).where(eq(org.userId, user.id));
  revalidatePath("/settings");
}

/** Save org profile from onboarding or settings (includes logo URL). */
export async function saveOrgProfile(data: {
  name: string;
  kraPin?: string;
  vatRegistered: boolean;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  invoicePrefix: string;
  invoiceTemplate?: string;
  quoteTemplate?: string;
  logoUrl?: string;
  brandColor?: string;
  customDocumentColumnName?: string;
  documentFooterText?: string;
  paymentInfoText?: string;
  termsText?: string;
  dataSegregation?: boolean;
  requireBillApproval?: boolean;
  accountantApprovalLimitCents?: number | null;
  approvalRequestPhone?: string;
  accountantNotifyPhone?: string;
  restrictIssuedInvoiceEdit?: boolean;
  issuedInvoiceEditRoles?: string;
  expenseClaimPayoutLimitCents?: number | null;
  expenseClaimPayoutGatewayId?: string | null;
  billPayoutGatewayId?: string | null;
  timeTrackingEnabled?: boolean;
  itemGroupsEnabled?: boolean;
  customerGroupsEnabled?: boolean;
  bomEnabled?: boolean;
  blockInsufficientStock?: boolean;
  nextInvoiceNo?: number;
  nextQuoteNo?: number;
}) {
  const user = await getUser();
  if (!user) throw new Error("Not authenticated");
  
  const access = await getAccess();
  
  if (access) {
    if (!access.isOwner && access.role !== "admin") {
      throw new Error("Not authorized to update org settings");
    }
    await db
      .update(org)
      .set({
        name: data.name,
        kraPin: data.kraPin,
        vatRegistered: data.vatRegistered,
        address: data.address,
        phone: data.phone,
        email: data.email,
        invoicePrefix: data.invoicePrefix || "INV-",
        ...(data.invoiceTemplate !== undefined ? { invoiceTemplate: data.invoiceTemplate } : {}),
        ...(data.quoteTemplate !== undefined ? { quoteTemplate: data.quoteTemplate } : {}),
        ...(data.website !== undefined ? { website: data.website || null } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        ...(data.brandColor !== undefined ? { brandColor: data.brandColor } : {}),
        ...(data.customDocumentColumnName !== undefined ? { customDocumentColumnName: data.customDocumentColumnName } : {}),
        ...(data.documentFooterText !== undefined ? { documentFooterText: data.documentFooterText } : {}),
        ...(data.paymentInfoText !== undefined ? { paymentInfoText: data.paymentInfoText } : {}),
        ...(data.termsText !== undefined ? { termsText: data.termsText } : {}),
        ...(data.dataSegregation !== undefined ? { dataSegregation: data.dataSegregation } : {}),
        ...(data.requireBillApproval !== undefined ? { requireBillApproval: data.requireBillApproval } : {}),
        ...(data.accountantApprovalLimitCents !== undefined ? { accountantApprovalLimitCents: data.accountantApprovalLimitCents } : {}),
        ...(data.approvalRequestPhone !== undefined ? { approvalRequestPhone: data.approvalRequestPhone || null } : {}),
        ...(data.accountantNotifyPhone !== undefined ? { accountantNotifyPhone: data.accountantNotifyPhone || null } : {}),
        ...(data.restrictIssuedInvoiceEdit !== undefined ? { restrictIssuedInvoiceEdit: data.restrictIssuedInvoiceEdit } : {}),
        ...(data.issuedInvoiceEditRoles !== undefined ? { issuedInvoiceEditRoles: data.issuedInvoiceEditRoles } : {}),
        ...(data.expenseClaimPayoutLimitCents !== undefined ? { expenseClaimPayoutLimitCents: data.expenseClaimPayoutLimitCents } : {}),
        ...(data.expenseClaimPayoutGatewayId !== undefined ? { expenseClaimPayoutGatewayId: data.expenseClaimPayoutGatewayId || null } : {}),
        ...(data.billPayoutGatewayId !== undefined ? { billPayoutGatewayId: data.billPayoutGatewayId || null } : {}),
        ...(data.timeTrackingEnabled !== undefined ? { timeTrackingEnabled: data.timeTrackingEnabled } : {}),
        ...(data.itemGroupsEnabled !== undefined ? { itemGroupsEnabled: data.itemGroupsEnabled } : {}),
        ...(data.customerGroupsEnabled !== undefined ? { customerGroupsEnabled: data.customerGroupsEnabled } : {}),
        ...(data.bomEnabled !== undefined ? { bomEnabled: data.bomEnabled } : {}),
        ...(data.blockInsufficientStock !== undefined ? { blockInsufficientStock: data.blockInsufficientStock } : {}),
        ...(data.nextInvoiceNo !== undefined ? { nextInvoiceNo: data.nextInvoiceNo } : {}),
        ...(data.nextQuoteNo !== undefined ? { nextQuoteNo: data.nextQuoteNo } : {}),
      })
      .where(eq(org.id, access.orgId));
  } else {
    const [saved] = await db
      .insert(org)
      .values({
        userId: user.id,
        name: data.name,
        kraPin: data.kraPin,
        vatRegistered: data.vatRegistered,
        address: data.address,
        phone: data.phone,
        email: data.email,
        invoicePrefix: data.invoicePrefix || "INV-",
        ...(data.invoiceTemplate !== undefined ? { invoiceTemplate: data.invoiceTemplate } : {}),
        ...(data.quoteTemplate !== undefined ? { quoteTemplate: data.quoteTemplate } : {}),
        ...(data.website !== undefined ? { website: data.website || null } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        ...(data.brandColor !== undefined ? { brandColor: data.brandColor } : {}),
        ...(data.customDocumentColumnName !== undefined ? { customDocumentColumnName: data.customDocumentColumnName } : {}),
        ...(data.documentFooterText !== undefined ? { documentFooterText: data.documentFooterText } : {}),
        ...(data.paymentInfoText !== undefined ? { paymentInfoText: data.paymentInfoText } : {}),
        ...(data.termsText !== undefined ? { termsText: data.termsText } : {}),
        ...(data.dataSegregation !== undefined ? { dataSegregation: data.dataSegregation } : {}),
        ...(data.requireBillApproval !== undefined ? { requireBillApproval: data.requireBillApproval } : {}),
        ...(data.accountantApprovalLimitCents !== undefined ? { accountantApprovalLimitCents: data.accountantApprovalLimitCents } : {}),
        ...(data.approvalRequestPhone !== undefined ? { approvalRequestPhone: data.approvalRequestPhone || null } : {}),
        ...(data.accountantNotifyPhone !== undefined ? { accountantNotifyPhone: data.accountantNotifyPhone || null } : {}),
        ...(data.restrictIssuedInvoiceEdit !== undefined ? { restrictIssuedInvoiceEdit: data.restrictIssuedInvoiceEdit } : {}),
        ...(data.issuedInvoiceEditRoles !== undefined ? { issuedInvoiceEditRoles: data.issuedInvoiceEditRoles } : {}),
        ...(data.expenseClaimPayoutLimitCents !== undefined ? { expenseClaimPayoutLimitCents: data.expenseClaimPayoutLimitCents } : {}),
        ...(data.nextInvoiceNo !== undefined ? { nextInvoiceNo: data.nextInvoiceNo } : {}),
        ...(data.nextQuoteNo !== undefined ? { nextQuoteNo: data.nextQuoteNo } : {}),
        ...(data.timeTrackingEnabled !== undefined ? { timeTrackingEnabled: data.timeTrackingEnabled } : {}),
        ...(data.itemGroupsEnabled !== undefined ? { itemGroupsEnabled: data.itemGroupsEnabled } : {}),
        ...(data.customerGroupsEnabled !== undefined ? { customerGroupsEnabled: data.customerGroupsEnabled } : {}),
        ...(data.bomEnabled !== undefined ? { bomEnabled: data.bomEnabled } : {}),
        ...(data.blockInsufficientStock !== undefined ? { blockInsufficientStock: data.blockInsufficientStock } : {}),
      })
      .returning();
    await seedOrgDefaults(saved.id);
  }

  await logAudit({ action: "update", module: "settings", recordLabel: "Organization profile" });
  revalidatePath("/settings");
  revalidatePath("/");
}

/** Admin-only, org-wide toggles for what staff see on the home dashboard —
 *  lives on the Staff & Roles page since it's about staff visibility, not
 *  general org profile settings. */
export async function setDashboardVisibilityAction(data: {
  showCollectedThisYearCard?: boolean;
  showInvoiceCollectionTotals?: boolean;
}) {
  const access = await getAccess();
  if (!access || (!access.isOwner && access.role !== "admin")) {
    throw new Error("Only admins can change staff dashboard visibility");
  }
  await db
    .update(org)
    .set({
      ...(data.showCollectedThisYearCard !== undefined ? { showCollectedThisYearCard: data.showCollectedThisYearCard } : {}),
      ...(data.showInvoiceCollectionTotals !== undefined ? { showInvoiceCollectionTotals: data.showInvoiceCollectionTotals } : {}),
    })
    .where(eq(org.id, access.orgId));
  await logAudit({ action: "update", module: "settings", recordLabel: "Staff dashboard visibility" });
  revalidatePath("/staff");
  revalidatePath("/");
}

export async function getTaxClasses() {
  return TAX_CLASSES;
}

/* ---- org-context wrappers: every action runs inside withOrg so currentOrgId() is set ---- */
export async function saveContact(data: Parameters<typeof _saveContact>[0]) {
  const result = await withOrg(() => _saveContact(data));
  await logAudit({
    action: data.id ? "update" : "create",
    module: "contacts",
    recordId: data.id ?? null,
    recordLabel: data.displayName,
  });
  return result;
}
export async function addActivity(contactId: number, kind: string, content: string) {
  return withOrg(() => _addActivity(contactId, kind, content));
}
export async function saveDeal(data: Parameters<typeof _saveDeal>[0]) {
  return withOrg(() => _saveDeal(data));
}
export async function moveDealStage(dealId: number, stage: string) {
  return withOrg(() => _moveDealStage(dealId, stage));
}
export async function saveItem(data: Parameters<typeof _saveItem>[0]) {
  return withOrg(() => _saveItem(data));
}

/**
 * Creates a new item on the fly from a bill/PO line for a product not yet in
 * the Items list, then notifies admins/accountants it was added.
 */
export async function createItemFromLine(data: {
  name: string;
  purchaseCostCents: number;
  taxClass: string;
  itemGroupId?: number | null;
}) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const id = await _saveItem({
      kind: "goods",
      itemGroupId: data.itemGroupId,
      name: data.name,
      unit: "unit",
      salePriceCents: 0,
      purchaseCostCents: data.purchaseCostCents,
      taxClass: data.taxClass,
      trackInventory: true,
      reorderLevel: 0,
    });
    await notifyOrg(orgId, ["admin", "accountant"], "New item added", `"${data.name}" was added to Items from a purchase.`, "/items");
    return id;
  });
}
export async function adjustStock(itemId: number, qtyDelta: number, unitCostCents: number, reason: string, reasonType?: "shrinkage" | "used_in_production") {
  const result = await withOrg(() => _adjustStock(itemId, qtyDelta, unitCostCents, reason, reasonType));
  const [item] = await db.select({ name: items.name }).from(items).where(eq(items.id, itemId)).limit(1);
  await logAudit({
    action: "adjust",
    module: "items",
    recordId: itemId,
    recordLabel: item?.name,
    detail: `${qtyDelta > 0 ? "+" : ""}${qtyDelta} — ${reason}`,
  });
  return result;
}
export async function saveDocument(data: Parameters<typeof _saveDocument>[0]) {
  // Only enforced here, not inside _saveDocument itself — convertPoToBill
  // calls _saveDocument directly, and old POs created before purchase orders
  // collected this must still be able to convert without being blocked.
  if (data.type === "bill" || data.type === "purchase_order") {
    if (!data.payoutDestinationType) throw new Error("Select how this vendor gets paid (mobile number, till, or paybill)");
    if (!data.payoutDestination?.trim()) throw new Error("Enter the vendor's payout destination");
    if (data.payoutDestinationType === "paybill" && !data.payoutAccountNumber?.trim()) throw new Error("Enter the paybill account number");
  }
  if (data.type === "bill" || data.type === "expense" || data.type === "purchase_order") {
    for (const l of data.lines) {
      if (!l.accountId) throw new Error(`Pick a category for "${l.description || "a line"}"`);
    }
    const orgIdForCostCenters = data.id
      ? (await db.select({ orgId: documents.orgId }).from(documents).where(eq(documents.id, data.id)).limit(1))[0]?.orgId
      : (await getAccess())?.orgId;
    if (orgIdForCostCenters) {
      const [{ count }] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(costCenters).where(eq(costCenters.orgId, orgIdForCostCenters));
      if (count > 0) {
        for (const l of data.lines) {
          if (!l.costCenterId) throw new Error(`Pick a cost center for "${l.description || "a line"}"`);
        }
      }
    }
  }
  const access = await getAccess();
  if (access && !access.isOwner && access.role !== "admin" && access.memberId) {
    data.assignedMemberIds = Array.from(new Set([...(data.assignedMemberIds || []), access.memberId]));
  }
  // Snapshot the creator on new documents only — editing a draft shouldn't reassign authorship.
  if (!data.id && access) {
    data.createdByName = access.memberName;
    data.createdByRole = access.isOwner ? "owner" : access.role;
  }
  // Plan cap covers new invoices/quotes only — editing a draft or creating
  // bills/expenses/etc doesn't consume it. Server-side check: the page-level
  // UpgradePrompt is cosmetic and doesn't stop a direct call to this action.
  if (!data.id && (data.type === "invoice" || data.type === "quote") && access) {
    const { assertInvoiceCapacity } = await import("./billing-server");
    await assertInvoiceCapacity(access.orgId);
  }
  const docId = await withOrg(() => _saveDocument(data), { requireWrite: true });
  const [saved] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, docId)).limit(1);
  await logAudit({
    action: data.id ? "update" : "create",
    module: DOC_MODULE[data.type],
    recordId: docId,
    recordLabel: saved?.number,
  });
  return docId;
}
export async function upsertDocumentAction(
  input: Parameters<typeof _saveDocument>[0] & { issue?: boolean }
): Promise<{ id?: number; error?: string }> {
  try {
    const { issue, ...data } = input;
    const docId = await saveDocument(data);
    if (issue) {
      const issueResult = await issueDocument(docId);
      if (issueResult?.error) return { error: issueResult.error };
    }
    return { id: docId };
  } catch (err: any) {
    return { error: err?.message || "Failed to save document" };
  }
}
export async function issueDocument(docId: number): Promise<{ success?: true; error?: string }> {
  try {
    await withOrg(() => _issueDocument(docId), { requireWrite: true });
    const [doc] = await db.select({ number: documents.number, type: documents.type }).from(documents).where(eq(documents.id, docId)).limit(1);
    await logAudit({ action: "issue", module: doc ? DOC_MODULE[doc.type] : "invoices", recordId: docId, recordLabel: doc?.number });
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || "Failed to issue document" };
  }
}

function spendModule(type: "bill" | "expense"): "bills" | "expenses" {
  return type === "bill" ? "bills" : "expenses";
}

function spendLink(type: "bill" | "expense", docId: number) {
  return `/purchases/${type === "bill" ? "bills" : "expenses"}/${docId}`;
}

async function assertSpendApprovalAccess(doc: { type: "bill" | "expense"; totalCents: number }) {
  const access = await getAccess();
  if (!access?.perms.has("accountant")) throw new Error("Not authorized to approve this document");
  const o = await getOrg();
  if (!canApproveSpend({ access, totalCents: doc.totalCents, accountantApprovalLimitCents: o.accountantApprovalLimitCents })) {
    throw new Error(`Only an admin can approve or reject ${doc.type}s above ${fmtKES(o.accountantApprovalLimitCents ?? 0)}.`);
  }
  return access;
}

async function _approvePendingSpend(docId: number, options?: { bypassAccess?: boolean }) {
  const orgId = currentOrgId();
  const [pendingDoc] = await db
    .select({ id: documents.id, type: documents.type, number: documents.number, totalCents: documents.totalCents })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, docId), inArray(documents.type, ["bill", "expense"]), eq(documents.status, "pending_approval")))
    .limit(1);
  if (!pendingDoc || !isSpendApprovalType(pendingDoc.type)) throw new Error("This document isn't awaiting approval");
  const approvableDoc = { ...pendingDoc, type: pendingDoc.type as "bill" | "expense" };
  if (!options?.bypassAccess) await assertSpendApprovalAccess(approvableDoc);

  const [claimed] = await db
    .update(documents)
    .set({ status: "approving" })
    .where(and(eq(documents.orgId, orgId), eq(documents.id, docId), inArray(documents.type, ["bill", "expense"]), eq(documents.status, "pending_approval")))
    .returning();
  if (!claimed || !isSpendApprovalType(claimed.type)) throw new Error("This document isn't awaiting approval");

  try {
    if (claimed.type === "bill") await postBill(docId);
    else await postExpense(docId);
  } catch (e) {
    await db.update(documents).set({ status: "pending_approval" }).where(and(eq(documents.orgId, orgId), eq(documents.id, docId), eq(documents.status, "approving")));
    throw e;
  }

  revalidatePath("/purchases");
  revalidatePath(spendLink(claimed.type, docId));
  return { id: claimed.id, type: claimed.type as "bill" | "expense", number: claimed.number };
}

async function _rejectPendingSpend(docId: number, note: string, options?: { bypassAccess?: boolean }) {
  const orgId = currentOrgId();
  const [pendingDoc] = await db
    .select({ id: documents.id, type: documents.type, totalCents: documents.totalCents })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, docId), inArray(documents.type, ["bill", "expense"]), eq(documents.status, "pending_approval")))
    .limit(1);
  if (!pendingDoc || !isSpendApprovalType(pendingDoc.type)) throw new Error("This document isn't awaiting approval");
  const approvableDoc = { ...pendingDoc, type: pendingDoc.type as "bill" | "expense" };
  if (!options?.bypassAccess) await assertSpendApprovalAccess(approvableDoc);

  const [claimed] = await db
    .update(documents)
    .set({ status: "draft", approvalNote: note || "Rejected" })
    .where(and(eq(documents.orgId, orgId), eq(documents.id, docId), inArray(documents.type, ["bill", "expense"]), eq(documents.status, "pending_approval")))
    .returning();
  if (!claimed || !isSpendApprovalType(claimed.type)) throw new Error("This document isn't awaiting approval");

  revalidatePath("/purchases");
  revalidatePath(spendLink(claimed.type, docId));
  return { id: claimed.id, type: claimed.type as "bill" | "expense", number: claimed.number };
}

/** Approve a bill or expense pending approval and post it to the ledger. */
export async function approveSpendAction(docId: number) {
  return withOrg(async () => {
    const claimed = await _approvePendingSpend(docId);
    await logAudit({ action: "approve", module: spendModule(claimed.type), recordId: docId, recordLabel: claimed.number });
    return { success: true };
  }, { requireWrite: true });
}

/** Reject a bill or expense pending approval, sending it back to draft with a note for the submitter. */
export async function rejectSpendAction(docId: number, note: string) {
  return withOrg(async () => {
    const claimed = await _rejectPendingSpend(docId, note);
    await logAudit({ action: "reject", module: spendModule(claimed.type), recordId: docId, recordLabel: claimed.number, detail: note || undefined });
    return { success: true };
  });
}

export async function approveBillAction(docId: number) {
  return approveSpendAction(docId);
}

export async function rejectBillAction(docId: number, note: string) {
  return rejectSpendAction(docId, note);
}

export async function respondToApprovalRequestAction(token: string, decision: "approved" | "rejected", note?: string) {
  const row = await getApprovalRequestByToken(token);
  if (!row) return { error: "This approval link is no longer valid." };

  return orgContext.run(row.orgRow.id, async () => {
    try {
      if (decision === "approved") {
        const claimed = await _approvePendingSpend(row.doc.id, { bypassAccess: true });
        await markApprovalTokenUsed({ tokenId: row.req.id, orgId: row.orgRow.id, documentId: row.doc.id, decision });
        await notifyOrg(currentOrgId(), ["admin", "accountant"], `${claimed.type === "bill" ? "Bill" : "Expense"} approved remotely`, `${claimed.number} was approved from the SMS approval link.`, spendLink(claimed.type, claimed.id));

        // Bills capture a mandatory payout destination at creation — approving
        // from this link is Kevin's one tap, so pay it out immediately instead
        // of making him tap a second "Pay" button (which, on older bills with
        // no destination, just failed and sent him back to the dashboard to
        // enter payment details manually — the exact complaint this replaces).
        // Best-effort: a missing gateway/destination just leaves the bill
        // approved-but-unpaid for the accountant to pay manually, same as before.
        if (claimed.type === "bill") {
          await executeBillGatewayPayout(row.orgRow.id, claimed.id, row.orgRow.billPayoutGatewayId);
        }
      } else {
        const claimed = await _rejectPendingSpend(row.doc.id, note || "Rejected from approval link", { bypassAccess: true });
        await markApprovalTokenUsed({ tokenId: row.req.id, orgId: row.orgRow.id, documentId: row.doc.id, decision, note: note || "Rejected from approval link" });
        await notifyOrg(currentOrgId(), ["admin", "accountant"], `${claimed.type === "bill" ? "Bill" : "Expense"} rejected remotely`, `${claimed.number} was rejected from the SMS approval link.`, spendLink(claimed.type, claimed.id));
      }
      revalidatePath(`/approve/${token}`);
      return { success: true };
    } catch (err: any) {
      return { error: err?.message || "Failed to process approval request" };
    }
  });
}

/**
 * Pays an already-approved bill out via gateway straight from the same SMS
 * approval link — no login, no trip to the dashboard. Only works on a token
 * whose decision is "approved" (i.e. this exact link's approval already
 * posted the bill), and only for bills, which capture a mandatory payout
 * destination at creation for exactly this reason (expenses/POs don't).
 * Posts the cash leg immediately (see the same reasoning in
 * executeGatewayPayoutForClaim for expense claims) rather than waiting on
 * the async gateway webhook.
 */
/** Core gateway payout for an approved, unpaid bill — pays its full outstanding
 *  balance to the destination captured on the bill. Shared by the SMS
 *  approval link's "Pay" button and the auto-pay-on-approval path below, so
 *  they can never drift out of sync with each other. Must be called already
 *  inside the paying org's context (orgContext.run or withOrg). */
async function executeBillGatewayPayout(orgId: number, docId: number, billPayoutGatewayId: string | null): Promise<{ success?: true; error?: string }> {
  try {
    const [doc] = await db.select().from(documents).where(and(eq(documents.orgId, orgId), eq(documents.id, docId))).limit(1);
    if (!doc) return { error: "Bill not found." };
    const outstanding = doc.totalCents - doc.paidCents;
    if (outstanding <= 0) return { error: "This bill is already fully paid." };
    if (!doc.payoutDestinationType || !doc.payoutDestination) return { error: "No payout destination was set on this bill." };

    const [preferred] = billPayoutGatewayId
      ? await db.select().from(paymentGateways).where(and(eq(paymentGateways.orgId, orgId), eq(paymentGateways.enabled, true), eq(paymentGateways.gatewayId, billPayoutGatewayId))).limit(1)
      : [];
    const [fallback] = !preferred
      ? await db.select().from(paymentGateways).where(and(eq(paymentGateways.orgId, orgId), eq(paymentGateways.enabled, true))).limit(1)
      : [];
    const gwConfig = preferred || fallback;
    if (!gwConfig) return { error: "No payment gateway is connected for this org." };

    const gateway = getGateway(gwConfig);
    const [payee] = doc.contactId
      ? await db.select({ name: contacts.displayName }).from(contacts).where(and(eq(contacts.id, doc.contactId), eq(contacts.orgId, orgId))).limit(1)
      : [];

    // Placeholder inserted BEFORE the gateway call — if payOut() throws after
    // Kopo Kopo already moved the money (e.g. our request times out reading
    // the response), the old code left zero trace of the attempt. Now a
    // "pending" row survives so the accountant can reconcile it against the
    // confirmation SMS on their phone instead of the system showing nothing.
    const tempRef = `pending:${crypto.randomUUID()}`;
    const [placeholder] = await db.insert(paymentEvents).values({
      orgId,
      gatewayId: gwConfig.gatewayId,
      providerRef: tempRef,
      direction: "out",
      amountCents: outstanding,
      payerPhone: doc.payoutDestinationType === "phone" ? doc.payoutDestination : undefined,
      accountRef: doc.number,
      status: "pending",
      matchedDocumentId: doc.id,
      rawJson: JSON.stringify({ destination: doc.payoutDestination, destinationType: doc.payoutDestinationType, amountCents: outstanding }),
      createdAt: new Date().toISOString(),
    }).returning({ id: paymentEvents.id });

    let result: Awaited<ReturnType<typeof gateway.payOut>>;
    try {
      result = await gateway.payOut({
        destination: doc.payoutDestination,
        destinationType: doc.payoutDestinationType as "phone" | "till" | "paybill",
        accountNumber: doc.payoutAccountNumber || undefined,
        amountCents: outstanding,
        accountRef: doc.number,
        payeeName: payee?.name || undefined,
        reason: `Payout for bill ${doc.number}`,
      });
    } catch (e: any) {
      await db.update(paymentEvents).set({ status: "failed", rawJson: JSON.stringify({ destination: doc.payoutDestination, destinationType: doc.payoutDestinationType, amountCents: outstanding, error: e?.message }) }).where(eq(paymentEvents.id, placeholder.id));
      throw e;
    }

    await db.update(paymentEvents).set({
      providerRef: result.providerRef,
      status: "applied",
      rawJson: JSON.stringify({ payoutRef: result.providerRef, destination: doc.payoutDestination, destinationType: doc.payoutDestinationType, amountCents: outstanding }),
    }).where(eq(paymentEvents.id, placeholder.id));

    // Same reasoning as the M-Pesa till reconciliation engine: without an
    // explicit bankAccountId, postPayment() falls back to Undeposited
    // Funds instead of the real till.
    const [mpesaBank] = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.kind, "mpesa"), eq(bankAccounts.archived, false))).limit(1);

    const paymentId = await _recordPayment({
      direction: "out",
      documentId: doc.id,
      date: todayISO(),
      amountCents: outstanding,
      method: gwConfig.gatewayId === "mpesa_daraja" ? "mpesa" : "kopokopo",
      reference: shortRef(result.providerRef),
      bankAccountId: mpesaBank?.id,
    });
    // Kept so a later "disbursement actually failed" webhook can find and
    // reverse this exact payment — see reverseFailedGatewayPayout in webhook.ts.
    await db.update(paymentEvents).set({ paymentId }).where(eq(paymentEvents.id, placeholder.id));

    await logAudit({ action: "pay_approved_bill_remote", module: "bills", recordId: doc.id, recordLabel: doc.number, detail: `${fmtKES(outstanding)} via ${gwConfig.gatewayId}` });
    await notifyAccountantOfPayout(orgId, {
      label: `bill ${doc.number}`,
      amountCents: outstanding,
      destination: doc.payoutDestination,
      providerRef: result.providerRef,
      gatewayId: gwConfig.gatewayId,
      confirmed: false,
    });
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || "Failed to process payout" };
  }
}

export async function payApprovedBillGatewayAction(token: string): Promise<{ success?: true; error?: string }> {
  const row = await getApprovalRequestAnyState(token);
  if (!row) return { error: "This approval link is no longer valid." };
  if (row.req.decision !== "approved") return { error: "This bill hasn't been approved through this link yet." };
  if (row.doc.type !== "bill") return { error: "Only bills can be paid this way." };

  return orgContext.run(row.orgRow.id, async () => {
    const result = await executeBillGatewayPayout(row.orgRow.id, row.doc.id, row.orgRow.billPayoutGatewayId);
    if (result.success) nextRevalidatePath(`/approve/${token}`);
    return result;
  });
}

export async function voidDoc(docId: number) {
  const [doc] = await db.select({ number: documents.number, type: documents.type }).from(documents).where(eq(documents.id, docId)).limit(1);
  const result = await withOrg(() => _voidDoc(docId));
  await logAudit({ action: "void", module: doc ? DOC_MODULE[doc.type] : "invoices", recordId: docId, recordLabel: doc?.number });
  return result;
}
export async function markQuote(docId: number, status: "accepted" | "declined") {
  const result = await withOrg(() => _markQuote(docId, status));
  const [doc] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, docId)).limit(1);
  await logAudit({ action: status, module: "quotes", recordId: docId, recordLabel: doc?.number });
  return result;
}
export async function convertQuoteToInvoice(quoteId: number) {
  const invId = await withOrg(() => _convertQuoteToInvoice(quoteId));
  const [doc] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, invId)).limit(1);
  await logAudit({ action: "convert_from_quote", module: "invoices", recordId: invId, recordLabel: doc?.number });
  return invId;
}
export async function recordPayment(data: Parameters<typeof _recordPayment>[0]) {
  const paymentId = await withOrg(() => _recordPayment(data));
  await logAudit({
    action: data.direction === "out" ? "pay_out" : "receive",
    module: "payments",
    recordId: paymentId,
    recordLabel: data.reference || `Payment #${paymentId}`,
    detail: `${fmtKES(data.amountCents)} via ${data.method}`,
  });
  return paymentId;
}
export async function addBankTransaction(data: Parameters<typeof _addBankTransaction>[0]) {
  return withOrg(() => _addBankTransaction(data));
}
export async function setMoneyAccountOpeningBalanceAction(
  data: Parameters<typeof _setMoneyAccountOpeningBalance>[0]
) {
  return withOrg(async () => {
    await _setMoneyAccountOpeningBalance(data);
    return { success: true };
  }, { requireWrite: true });
}
export async function categorizeTransaction(txnId: number, categoryAccountId: number) {
  return withOrg(() => _categorizeTransaction(txnId, categoryAccountId));
}
export async function bulkCategorizeTransactions(updates: { txnId: number; categoryAccountId: number }[]) {
  return withOrg(() => _bulkCategorizeTransactions(updates));
}
export async function createManualJournal(data: Parameters<typeof _createManualJournal>[0]) {
  const result = await withOrg(() => _createManualJournal(data));
  await logAudit({ action: "create", module: "accountant", recordLabel: data.memo || "Manual journal entry" });
  return result;
}

/* ---------------- Credit note from invoice / PO → bill ---------------- */

async function _createCreditNoteFromInvoice(invoiceId: number): Promise<number> {
  const [inv] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, invoiceId)))
    .limit(1);
  if (!inv || inv.type !== "invoice") throw new Error("Invoice not found");
  const lines = await db
    .select()
    .from(documentLines)
    .where(and(eq(documentLines.orgId, currentOrgId()), eq(documentLines.documentId, invoiceId)));
  const cnId = await _saveDocument({
    type: "credit_note",
    contactId: inv.contactId,
    date: todayISO(),
    taxInclusive: inv.taxInclusive,
    notes: `Credit note for invoice ${inv.number}`,
    lines: lines.map((l) => ({
      itemId: l.itemId,
      description: l.description,
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      discountPct: l.discountPct,
      taxClass: l.taxClass as TaxClass,
      accountId: l.accountId,
    })),
  });
  await db
    .update(documents)
    .set({ sourceDocId: invoiceId })
    .where(and(eq(documents.orgId, currentOrgId()), eq(documents.id, cnId)));
  return cnId;
}

/**
 * Convert a PO to a bill, optionally billing less than the full remaining quantity
 * per line (partial receipt). `lineQtys` maps documentLines.id → qty to bill now;
 * omit a line (or the whole map) to default to its full remaining quantity.
 */
async function _convertPoToBill(poId: number, lineQtys?: Record<number, number>): Promise<number> {
  const orgId = currentOrgId();
  // Captured BEFORE the claim below — .returning() on that UPDATE reflects
  // the row AFTER it's applied (status already "converting"), so the catch
  // block's restore used to read this same already-mutated value and write
  // "converting" right back — a no-op that permanently stranded the PO the
  // moment anything downstream threw (confirmed live: org 33's PO-0036,
  // unrenderable and unbillable, with billedQty never incremented since the
  // final status-set line never ran either).
  const [before] = await db.select({ status: documents.status }).from(documents).where(and(eq(documents.orgId, orgId), eq(documents.id, poId))).limit(1);
  const originalStatus = before?.status ?? "open";

  // Atomic claim: a PO can be claimed from "open" (nothing billed yet) or "partial"
  // (some already billed) — but not from "closed" (fully billed) or mid-claim by
  // a concurrent request, closing the original "no guard at all" bug.
  const [po] = await db
    .update(documents)
    .set({ status: "converting" })
    .where(and(
      eq(documents.orgId, orgId), eq(documents.id, poId), eq(documents.type, "purchase_order"),
      sql`${documents.status} IN ('open', 'partial')`
    ))
    .returning();
  if (!po) throw new Error("This purchase order was already fully billed (or isn't open)");
  try {
    const poLines = await db
      .select()
      .from(documentLines)
      .where(and(eq(documentLines.orgId, orgId), eq(documentLines.documentId, poId)))
      .orderBy(documentLines.position);

    const toBill: { line: typeof poLines[number]; qty: number }[] = [];
    for (const l of poLines) {
      const remaining = l.qty - l.billedQty;
      const requested = lineQtys?.[l.id] ?? remaining;
      if (requested < 0) throw new Error(`Can't bill a negative quantity for "${l.description}"`);
      if (requested > remaining + 1e-9) throw new Error(`"${l.description}" only has ${remaining} remaining to bill`);
      if (requested > 0) toBill.push({ line: l, qty: requested });
    }
    if (toBill.length === 0) throw new Error("Nothing left to bill on this purchase order");

    // _convertPoToBill calls _saveDocument directly rather than the public
    // saveDocument() wrapper (already inside its own withOrg), so it has to
    // replicate the wrapper's auto-assign-the-actor and creator-attribution
    // steps itself — without this, a converted bill was invisible to the
    // converting accountant under staff data segregation (no assignment row)
    // and showed no creator on the document.
    const access = await getAccess();
    const assignedMemberIds = access && !access.isOwner && access.role !== "admin" && access.memberId ? [access.memberId] : undefined;

    const billId = await _saveDocument({
      type: "bill",
      contactId: po.contactId,
      date: todayISO(),
      taxInclusive: po.taxInclusive,
      billNumber: `BILL-${po.number}`,
      notes: po.notes ?? undefined,
      // Carried from the PO so the resulting bill can be paid straight from
      // the admin approval link without anyone having to open it and fill
      // this in manually — previously dropped entirely on conversion.
      payoutDestinationType: po.payoutDestinationType as "phone" | "till" | "paybill" | null | undefined,
      payoutDestination: po.payoutDestination,
      payoutAccountNumber: po.payoutAccountNumber,
      assignedMemberIds,
      createdByName: access?.memberName,
      createdByRole: access ? (access.isOwner ? "owner" : access.role) : undefined,
      lines: toBill.map(({ line: l, qty }) => ({
        itemId: l.itemId,
        description: l.description,
        qty,
        unitPriceCents: l.unitPriceCents,
        discountPct: l.discountPct,
        taxClass: l.taxClass as TaxClass,
        accountId: l.accountId,
        // Previously dropped on conversion — the bill posted with no cost
        // center tag on its journal lines and, for stocked items, lost the
        // warehouse the receipt should have gone into, even when the PO
        // itself had both set correctly.
        costCenterId: l.costCenterId,
        warehouseId: l.warehouseId,
      })),
    });
    await db
      .update(documents)
      .set({ sourceDocId: poId })
      .where(and(eq(documents.orgId, orgId), eq(documents.id, billId)));

    // _saveDocument only ever creates a draft — without this, the bill sat
    // as an invisible, unissued draft forever: never posted to the ledger,
    // never routed into the approval workflow (if the org requires one),
    // and absent from the Bills screen's normal "what needs my attention"
    // view even though the PO already showed it as "converted to bill".
    await _issueDocument(billId);

    for (const { line: l, qty } of toBill) {
      await db.update(documentLines).set({ billedQty: l.billedQty + qty }).where(eq(documentLines.id, l.id));
    }
    const fullyBilled = poLines.every((l) => {
      const billedNow = toBill.find((t) => t.line.id === l.id)?.qty ?? 0;
      return l.billedQty + billedNow >= l.qty - 1e-9;
    });
    await db
      .update(documents)
      .set({ status: fullyBilled ? "closed" : "partial" })
      .where(and(eq(documents.orgId, orgId), eq(documents.id, poId)));
    revalidatePath("/purchases");
    return billId;
  } catch (e) {
    await db.update(documents).set({ status: originalStatus }).where(and(eq(documents.orgId, orgId), eq(documents.id, poId), eq(documents.status, "converting")));
    throw e;
  }
}

/* ---------------- Bank statement import ---------------- */

async function _importBankTransactions(
  bankAccountId: number,
  rows: { date: string; description: string; amountCents: number }[]
): Promise<number> {
  const valid = rows.filter((r) => r.date && r.amountCents !== 0);
  if (valid.length === 0) return 0;
  await db.insert(bankTransactions).values(
    valid.map((r) => ({
      orgId: currentOrgId(),
      bankAccountId,
      date: r.date,
      description: r.description || "Imported transaction",
      amountCents: r.amountCents,
      createdAt: nowISO(),
    }))
  );
  revalidatePath("/banking");
  return valid.length;
}

export async function createCreditNoteFromInvoice(invoiceId: number) {
  return withOrg(() => _createCreditNoteFromInvoice(invoiceId));
}
export async function convertPoToBill(poId: number, lineQtys?: Record<number, number>) {
  const billId = await withOrg(() => _convertPoToBill(poId, lineQtys));
  const [[po], [bill]] = await Promise.all([
    db.select({ number: documents.number }).from(documents).where(eq(documents.id, poId)).limit(1),
    db.select({ number: documents.number }).from(documents).where(eq(documents.id, billId)).limit(1),
  ]);
  await logAudit({
    action: "convert_from_po",
    module: "bills",
    recordId: billId,
    recordLabel: bill?.number,
    detail: po?.number ? `Converted from PO ${po.number}` : undefined,
  });
  return billId;
}
export async function importBankTransactions(
  bankAccountId: number,
  rows: { date: string; description: string; amountCents: number }[]
) {
  return withOrg(() => _importBankTransactions(bankAccountId, rows));
}

/* ---------------- Categorization rules ---------------- */

export async function applyCategorizationRules(): Promise<{ applied: number }> {
  return withOrg(async () => {
    const { applyRulesToUncategorized } = await import("./categorization");
    const updates = await applyRulesToUncategorized();
    for (const { txnId, categoryAccountId } of updates) {
      await _categorizeTransaction(txnId, categoryAccountId);
    }
    revalidatePath("/banking");
    return { applied: updates.length };
  });
}

export async function listCategorizationRules() {
  return withOrg(async () => {
    const { listRules } = await import("./categorization");
    return listRules();
  });
}

export async function deleteCategorizationRule(ruleId: number) {
  return withOrg(async () => {
    const { deleteRule } = await import("./categorization");
    await deleteRule(ruleId);
    revalidatePath("/banking");
  });
}

/* ---------------- Client Portal ---------------- */

export async function updatePortalUserAction(contactId: number, email: string, password?: string) {
  return withOrg(async () => {
    // we need crypto to hash password
    const crypto = await import("crypto");
    const { portalUsers } = await import("@/db");
    const orgId = currentOrgId();
    
    const [existing] = await db.select().from(portalUsers)
      .where(and(eq(portalUsers.orgId, orgId), eq(portalUsers.contactId, contactId)))
      .limit(1);

    if (existing) {
      const updates: any = { email };
      if (password) {
        updates.passwordHash = crypto.createHash("sha256").update(password).digest("hex");
      }
      await db.update(portalUsers)
        .set(updates)
        .where(eq(portalUsers.id, existing.id));
    } else {
      if (!password) return { error: "Password is required for new users." };
      
      // Check email collision across the org
      const [emailClash] = await db.select().from(portalUsers)
        .where(and(eq(portalUsers.orgId, orgId), eq(portalUsers.email, email)))
        .limit(1);
      
      if (emailClash) return { error: "Email is already in use by another contact." };

      const passwordHash = crypto.createHash("sha256").update(password).digest("hex");
      await db.insert(portalUsers).values({
        orgId,
        contactId,
        email,
        passwordHash,
        isActive: true,
        createdAt: new Date().toISOString(),
      });
    }

    revalidatePath(`/contacts/${contactId}`);
    return { success: true };
  });
}

export async function saveArticleAction(id: number | null, title: string, content: string, published: boolean) {
  return withOrg(async () => {
    const { knowledgeArticles } = await import("@/db");
    const orgId = currentOrgId();
    
    if (id) {
      await db.update(knowledgeArticles)
        .set({ title, content, published })
        .where(and(eq(knowledgeArticles.orgId, orgId), eq(knowledgeArticles.id, id)));
    } else {
      await db.insert(knowledgeArticles).values({
        orgId,
        title,
        content,
        published,
        createdAt: new Date().toISOString(),
      });
    }

    revalidatePath("/settings/knowledge-base");
    return { success: true };
  });
}


/**
 * Invoices belonging to one customer, for the "rebilled on" picker on
 * expenses and bills. Loaded on demand rather than shipping every invoice in
 * the org to the client.
 */
export async function listCustomerInvoices(contactId: number) {
  return withOrg(async () => {
    if (!contactId) return [];
    const rows = await db
      .select({
        id: documents.id,
        number: documents.number,
        date: documents.date,
        totalCents: documents.totalCents,
        status: documents.status,
      })
      .from(documents)
      .where(
        and(
          eq(documents.orgId, currentOrgId()),
          eq(documents.contactId, contactId),
          eq(documents.type, "invoice"),
          eq(documents.isTemplate, false),
          ne(documents.status, "void")
        )
      )
      .orderBy(desc(documents.date))
      .limit(200);
    return rows;
  });
}
