import { db, contacts, items, accounts, bankAccounts, members, documents, documentLines, documentAssignments, costCenters, warehouses, itemGroups, projects, customerGroups } from "@/db";
import { and, eq, inArray, desc } from "drizzle-orm";
import { getOrg } from "@/lib/org";
import { getAccess } from "@/lib/access";

/** Serialized option lists for the DocumentEditor (server → client). */
export async function editorOptions(side: "sale" | "purchase") {
  const org = await getOrg();
  const orgId = org.id;
  const access = await getAccess();
  // Assigning a document to a staff member is a managerial action — general
  // staff creating their own invoices/quotes/expenses shouldn't see (or be
  // able to set) it, only accountants/admins/the owner.
  const canAssignStaff = !!access && (access.isOwner || access.role === "admin" || access.role === "accountant");
  const wantedKinds = side === "sale" ? ["customer", "both"] : ["vendor", "both"];
  const contactRows = await db.select().from(contacts).where(and(eq(contacts.orgId, orgId), inArray(contacts.kind, wantedKinds)));
  // Expenses and bills can be tagged to the customer the cost was incurred for,
  // which is a different list from the vendor being paid — on a purchase
  // document `contactRows` holds vendors, so customers are loaded separately.
  const customerRows =
    side === "purchase"
      ? await db.select().from(contacts).where(and(eq(contacts.orgId, orgId), inArray(contacts.kind, ["customer", "both"])))
      : contactRows;
  const itemRows = await db.select().from(items).where(and(eq(items.orgId, orgId), eq(items.archived, false)));
  // Purchase lines are always added into Items as kind "goods" (createItemFromLine),
  // so only offer groups that actually allow goods here — a "services only" group
  // would silently violate validateItemGroup's appliesTo check on submit otherwise.
  const itemGroupRows = await db.select().from(itemGroups).where(and(eq(itemGroups.orgId, orgId), inArray(itemGroups.appliesTo, ["goods", "both"]))).orderBy(itemGroups.name);
  const expenseRows = await db.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.type, "expense")));
  const bankRows = await db.select().from(bankAccounts).where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.archived, false)));
  const memberRows = canAssignStaff
    ? await db.select().from(members).where(and(eq(members.orgId, orgId), eq(members.active, true)))
    : [];
  const costCenterRows = await db.select().from(costCenters).where(and(eq(costCenters.orgId, orgId), eq(costCenters.active, true)));
  const warehouseRows = await db.select().from(warehouses).where(and(eq(warehouses.orgId, orgId), eq(warehouses.archived, false)));
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.orgId, orgId)).orderBy(desc(projects.eventDate));
  const customerGroupRows = await db.select({ id: customerGroups.id, label: customerGroups.name }).from(customerGroups).where(eq(customerGroups.orgId, orgId)).orderBy(customerGroups.name);

  return {
    customDocumentColumnName: org.customDocumentColumnName,
    // For the editor's inline "+ New customer" — same group requirement
    // _saveContact() enforces, surfaced here so the picker knows whether to
    // show the group field before the user hits an error on submit.
    customerGroups: customerGroupRows,
    customerGroupsRequired: org.customerGroupsEnabled,
    members: memberRows.map((m) => ({ id: m.id, label: m.name || m.email })),
    contacts: contactRows.map((c) => ({ id: c.id, label: c.displayName })),
    // Purchase side only: vendor's saved default payout details, so the bill/
    // PO form can autofill them instead of the accountant retyping the same
    // M-Pesa number every time this vendor gets a bill.
    vendorPayouts: side === "purchase"
      ? Object.fromEntries(
          contactRows
            .filter((c) => c.payoutDestination)
            .map((c) => [c.id, { type: c.payoutDestinationType, destination: c.payoutDestination, accountNumber: c.payoutAccountNumber }])
        )
      : {},
    customers: customerRows.map((c) => ({ id: c.id, label: c.displayName })),
    items: itemRows.map((i) => ({
      id: i.id,
      name: i.name,
      salePriceCents: i.salePriceCents,
      purchaseCostCents: i.purchaseCostCents,
      taxClass: i.taxClass,
      unit: i.unit,
      trackInventory: i.trackInventory,
      measurementType: i.measurementType,
      purchaseAccountId: i.purchaseAccountId,
    })),
    itemGroups: itemGroupRows.map((g) => ({ id: g.id, label: g.name })),
    projects: projectRows.map((p) => ({ id: p.id, label: p.name })),
    itemGroupsRequired: org.itemGroupsEnabled,
    expenseAccounts: expenseRows.map((a) => ({ id: a.id, label: a.name })),
    bankAccounts: bankRows.map((b) => ({ id: b.id, label: b.name })),
    costCenters: costCenterRows.map((c) => ({ id: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name })),
    // Only surface a warehouse picker once an org actually has more than one —
    // single-location orgs never see this UI at all.
    warehouses: warehouseRows.length > 1 ? warehouseRows.map((w) => ({ id: w.id, label: w.name })) : [],
  };
}

export async function fetchInitialData(docId: number) {
  const org = await getOrg();
  const [doc] = await db.select().from(documents).where(and(eq(documents.orgId, org.id), eq(documents.id, docId))).limit(1);
  if (!doc) throw new Error("Document not found");
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, docId)).orderBy(documentLines.position);
  const assignments = await db.select().from(documentAssignments).where(eq(documentAssignments.documentId, docId));

  return {
    id: doc.id,
    status: doc.status,
    contactId: doc.contactId ?? "",
    date: doc.date,
    dueDate: doc.dueDate ?? "",
    taxInclusive: doc.taxInclusive,
    isTemplate: doc.isTemplate,
    notes: doc.notes ?? "",
    billNumber: ["bill", "expense"].includes(doc.type) ? doc.number : "",
    paidFrom: doc.paidFromBankAccountId ?? "",
    assignedMemberIds: assignments.map(a => a.memberId),
    customerContactId: doc.customerContactId ?? "",
    relatedInvoiceId: doc.relatedInvoiceId ?? "",
    projectId: doc.projectId ?? "",
    lines: lines.map(l => ({
      itemId: l.itemId,
      description: l.description,
      qty: String(l.qty),
      price: (l.unitPriceCents / 100).toFixed(2),
      discountPct: String(l.discountPct),
      taxClass: l.taxClass as import("@/lib/tax").TaxClass,
      accountId: l.accountId,
      customColumnValue: l.customColumnValue ?? "",
      costCenterId: l.costCenterId,
      warehouseId: l.warehouseId,
      addToItems: false,
      newItemGroupId: null,
      isHeading: l.isHeading,
    }))
  };
}
