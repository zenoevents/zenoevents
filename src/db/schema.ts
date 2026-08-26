import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  doublePrecision,
  serial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * All money is stored as integer cents (KES). Quantities are doubles.
 * Every posted document links to a journal entry — the ledger is the truth.
 */

const money = (name: string) => bigint(name, { mode: "number" });

export const org = pgTable("org", {
  id: serial("id").primaryKey(),
  /** Supabase auth.users UUID — one org per user. */
  userId: text("user_id").unique(),
  name: text("name").notNull().default(""),
  /** Public customer-portal slug: zeno.com/p/<slug> */
  portalSlug: text("portal_slug").unique(),
  kraPin: text("kra_pin"),
  vatRegistered: boolean("vat_registered").notNull().default(true),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  /** Business website — shown as a clickable link on invoice/quote/bill etc.
   *  PDFs so a customer reading a printed/emailed document can tap through
   *  to it, same idea as the logo/brand color but for the website itself. */
  website: text("website"),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color").notNull().default("#0f766e"),
  invoicePrefix: text("invoice_prefix").notNull().default("INV-"),
  invoiceTemplate: text("invoice_template").notNull().default("default"),
  quoteTemplate: text("quote_template").notNull().default("default"),
  nextInvoiceNo: integer("next_invoice_no").notNull().default(1),
  nextQuoteNo: integer("next_quote_no").notNull().default(1),
  nextCreditNoteNo: integer("next_credit_note_no").notNull().default(1),
  nextPoNo: integer("next_po_no").notNull().default(1),
  nextPaymentNo: integer("next_payment_no").notNull().default(1),
  cuSerial: text("cu_serial"), // eTIMS control unit serial (simulated in v1)
  customDocumentColumnName: text("custom_document_column_name"),
  documentFooterText: text("document_footer_text"),
  paymentInfoText: text("payment_info_text"),
  termsText: text("terms_text"),
  dataSegregation: boolean("data_segregation").notNull().default(false),
  /** Staff home dashboard "Collected this year" stat card — admin-controlled, org-wide. */
  showCollectedThisYearCard: boolean("show_collected_this_year_card").notNull().default(true),
  /** Invoice & quote overview's yearly money breakdown (outstanding/past due/paid
   *  totals for the year) — separate from showBreakdown's own-vs-org-wide gate,
   *  lets an admin hide these totals from staff even when they can otherwise
   *  see org-wide data. */
  showInvoiceCollectionTotals: boolean("show_invoice_collection_totals").notNull().default(true),
  /** Manufacturing / Bill of Materials — off by default, most orgs resell
   *  items as-is rather than building products from components. Gates the
   *  BOM tab on the item form. */
  bomEnabled: boolean("bom_enabled").notNull().default(false),
  /** Refuse to post a sale when a tracked component (direct or via a kit's
   *  BOM) doesn't have enough stock on hand, instead of silently going
   *  negative at the last known cost. Off by default — some orgs sell ahead
   *  of stock intentionally and true up later. */
  blockInsufficientStock: boolean("block_insufficient_stock").notNull().default(false),
  /** Books lock: journal entries dated on/before this date are rejected. */
  lockDate: text("lock_date"),
  /** When on, posting a bill requires an accountant/admin to approve it first. */
  requireBillApproval: boolean("require_bill_approval").notNull().default(false),
  /** Optional per-accountant cap for spend approvals; null means accountants can approve any amount. */
  accountantApprovalLimitCents: money("accountant_approval_limit_cents"),
  /** Optional SMS destination for spend approvals; falls back to the org phone when blank. */
  approvalRequestPhone: text("approval_request_phone"),
  /** Optional SMS destination texted a payout confirmation every time a bill
   *  or expense claim is actually paid out via gateway (by anyone — admin or
   *  accountant) — so the accountant can independently verify money moved
   *  without phoning whoever paid it. Separate from approvalRequestPhone,
   *  which is for approval requests, not payout confirmations. */
  accountantNotifyPhone: text("accountant_notify_phone"),
  /** Off (default) = anyone with invoices access can edit an issued invoice
   *  (matches the behavior before this toggle existed... except editing was
   *  actually hard-blocked entirely before this — see the fix that shipped
   *  alongside this). On = only the roles in issuedInvoiceEditRoles (plus
   *  the owner, always) can. */
  restrictIssuedInvoiceEdit: boolean("restrict_issued_invoice_edit").notNull().default(false),
  /** JSON array of role strings, e.g. ["admin","accountant"]. Only consulted
   *  when restrictIssuedInvoiceEdit is on. */
  issuedInvoiceEditRoles: text("issued_invoice_edit_roles"),
  /** When on, staff see a clock-in/out card on their dashboard. */
  timeTrackingEnabled: boolean("time_tracking_enabled").notNull().default(false),
  /** When on, every item must belong to an admin-managed item group. */
  itemGroupsEnabled: boolean("item_groups_enabled").notNull().default(false),
  /** When on, every customer must belong to an admin-managed customer group.
   *  Defaults true — this was the unconditional, always-on behavior before
   *  this toggle existed, so existing orgs see no change unless they opt out. */
  customerGroupsEnabled: boolean("customer_groups_enabled").notNull().default(true),
  /** Max an accountant (not admin/owner) can pay out on an expense claim via
   *  gateway without admin approval first. 0 or null = unlimited — mirrors
   *  the bill-approval limit's shape but with 0-means-unlimited semantics,
   *  matching how this specific setting was specced. */
  expenseClaimPayoutLimitCents: money("expense_claim_payout_limit_cents"),
  /** Which connected gateway (mpesa_daraja | kopokopo) to use for automatic
   *  expense-claim payouts — orgs with more than one connected gateway can't
   *  have that picked implicitly ("first enabled"); null falls back to that
   *  first-enabled behavior for orgs that only have one anyway. */
  expenseClaimPayoutGatewayId: text("expense_claim_payout_gateway_id"),
  /** Which connected gateway actually settles this org's M-Pesa till —
   *  some orgs receive M-Pesa money through Kopo Kopo rather than a direct
   *  Daraja integration. Account routing itself doesn't need this (webhook.ts
   *  already posts any gateway's settlement into the bankAccounts row with
   *  kind='mpesa' regardless of which gateway confirmed it); this exists so
   *  the UI can label that account "(via Kopo Kopo)" instead of implying
   *  it's Safaricom Daraja specifically. Null = no non-Daraja gateway noted. */
  mpesaTillGatewayId: text("mpesa_till_gateway_id"),
  /** Default gateway pre-selected when paying a bill/vendor out via gateway —
   *  same "which of my connected gateways should this smoothly default to"
   *  pattern as expenseClaimPayoutGatewayId, just for vendor bill payouts.
   *  Null falls back to whichever connected gateway sorts first. */
  billPayoutGatewayId: text("bill_payout_gateway_id"),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  // asset | liability | equity | income | expense
  type: text("type").notNull(),
  subtype: text("subtype").notNull().default("other"),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  /** Optional parent for chart-of-accounts hierarchy (self-reference). */
  parentAccountId: integer("parent_account_id"),
}, (t) => ({
  orgIdx: index("idx_accounts_org").on(t.orgId),
  orgCodeUnique: uniqueIndex("idx_accounts_org_code").on(t.orgId, t.code),
  parentIdx: index("idx_accounts_parent").on(t.parentAccountId),
}));

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  kind: text("kind").notNull(), // customer | vendor | both
  displayName: text("display_name").notNull(),
  companyName: text("company_name"),
  email: text("email"),
  phone: text("phone"),
  kraPin: text("kra_pin"), // buyer PIN for eTIMS input-VAT claims
  address: text("address"),
  city: text("city"),
  notes: text("notes"),
  isWithholdingAgent: boolean("is_withholding_agent").notNull().default(false),
  /** Vendor's default payout details — optional. Autofills the payout
   *  destination fields on new bills/POs for this vendor so it doesn't have
   *  to be retyped every time; still editable per-document. */
  payoutDestinationType: text("payout_destination_type"), // phone | till | paybill
  payoutDestination: text("payout_destination"),
  payoutAccountNumber: text("payout_account_number"),
  /** Admin-defined customer segment. Required for new customers via the form;
   *  nullable so legacy/imported contacts stay valid as "Ungrouped". */
  groupId: integer("group_id"),
  archived: boolean("archived").notNull().default(false),
  /** Balance brought forward from a previous system, as of a chosen date —
   *  posts a real journal entry (DR/CR Accounts Receivable or Payable
   *  against "Opening Balance Adjustments", never revenue/expense) so the
   *  balance sheet and this contact's statement are correct without
   *  fabricating a backdated invoice/bill history. Mirrors the bank-account
   *  opening-balance pattern in _setMoneyAccountOpeningBalance. */
  openingBalanceCents: money("opening_balance_cents").notNull().default(0),
  openingBalanceDate: text("opening_balance_date"),
  openingBalanceEntryId: integer("opening_balance_entry_id"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgKindIdx: index("idx_contacts_org").on(t.orgId, t.kind),
  groupIdx: index("idx_contacts_group").on(t.orgId, t.groupId),
}));

/** Admin-created customer segments — tag customers to slice reports by segment. */
export const customerGroups = pgTable("customer_groups", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  /** Optional parent for nested subgroups (e.g. "Nairobi Office" -> "Wholesale"). Self-reference, same pattern as accounts.parentAccountId. */
  parentGroupId: integer("parent_group_id"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgNameUnique: uniqueIndex("idx_customer_groups_org_name").on(t.orgId, t.name),
  parentIdx: index("idx_customer_groups_parent").on(t.parentGroupId),
}));

/**
 * Customer ↔ group membership. A customer can belong to several groups (e.g.
 * Wholesale + NGO), so this is a join table rather than a column on contacts.
 * contacts.groupId is retained for back-compat but memberships are the truth.
 */
export const contactGroupMemberships = pgTable("contact_group_memberships", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  contactId: integer("contact_id").notNull(),
  groupId: integer("group_id").notNull(),
}, (t) => ({
  pairUnique: uniqueIndex("idx_contact_group_unique").on(t.contactId, t.groupId),
  groupIdx: index("idx_contact_group_by_group").on(t.orgId, t.groupId),
}));

export const activities = pgTable("activities", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  contactId: integer("contact_id").notNull(),
  kind: text("kind").notNull(), // note | call | email | meeting
  content: text("content").notNull(),
  date: text("date").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgContactIdx: index("idx_activities_org").on(t.orgId, t.contactId),
}));

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  plan: text("plan").notNull().default("free"), // free | standard | business
  status: text("status").notNull().default("active"), // active | expired
  paidUntil: text("paid_until").notNull(), // ISO date
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgUnique: uniqueIndex("idx_subscriptions_org").on(t.orgId),
}));

export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  contactId: integer("contact_id").notNull(),
  title: text("title").notNull(),
  amountCents: money("amount_cents").notNull().default(0),
  // lead | qualified | proposal | negotiation | won | lost
  stage: text("stage").notNull().default("lead"),
  expectedClose: text("expected_close"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  kind: text("kind").notNull(), // service | goods
  itemGroupId: integer("item_group_id"),
  name: text("name").notNull(),
  sku: text("sku"),
  unit: text("unit").notNull().default("unit"),
  description: text("description"),
  salePriceCents: money("sale_price_cents").notNull().default(0),
  purchaseCostCents: money("purchase_cost_cents").notNull().default(0),
  // eTIMS tax classes: B16 (16%), C0 (zero-rated), A_EXEMPT, D_NONVAT
  taxClass: text("tax_class").notNull().default("B16"),
  salesAccountId: integer("sales_account_id"),
  purchaseAccountId: integer("purchase_account_id"),
  trackInventory: boolean("track_inventory").notNull().default(false),
  /** How this item's qty is entered, when it's not just a plain count —
   *  "length" (a single number, e.g. meters off a roll) or "area" (width ×
   *  height entered separately, multiplied into one qty). Null = plain
   *  count, the default for most items. Purely a data-entry convenience:
   *  the stored qty/unit is identical either way, this only changes which
   *  input(s) the UI shows when entering it (opening stock, BOM lines,
   *  invoice/bill lines). */
  measurementType: text("measurement_type"), // null | length | area
  reorderLevel: doublePrecision("reorder_level").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
}, (t) => ({
  orgIdx: index("idx_items_org").on(t.orgId),
  groupIdx: index("idx_items_group").on(t.orgId, t.itemGroupId),
}));

/** Bill of Materials — what tracked-inventory components a finished/kit item
 *  is made from, and how much of each one unit of sale consumes. A parent
 *  item with rows here is a "kit": it carries no stock of its own — selling
 *  it consumes its components' FIFO stock instead (see consumeForSale in
 *  posting.ts). qtyPerUnit is the material actually in the product;
 *  wasteQtyPerUnit is unusable offcut/scrap consumed alongside it (e.g. a
 *  sticker roll's trimmed edge) — physically consumed the same way, but
 *  posted to a separate Production Waste expense account so it's visible
 *  instead of silently inflating the product's own cost. */
export const itemBoms = pgTable("item_boms", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  parentItemId: integer("parent_item_id").notNull(),
  componentItemId: integer("component_item_id").notNull(),
  qtyPerUnit: doublePrecision("qty_per_unit").notNull().default(1),
  wasteQtyPerUnit: doublePrecision("waste_qty_per_unit").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgParentIdx: index("idx_item_boms_org_parent").on(t.orgId, t.parentItemId),
}));

/** Admin-created item segments — can be enforced org-wide for inventory hygiene and reporting. */
export const itemGroups = pgTable("item_groups", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  /** Optional parent for nested subgroups. Self-reference, same pattern as accounts.parentAccountId. */
  parentGroupId: integer("parent_group_id"),
  /** goods | service | both — restricts which item kind can be assigned to this group. Default 'both' keeps every pre-existing group usable exactly as before. */
  appliesTo: text("applies_to").notNull().default("both"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgNameUnique: uniqueIndex("idx_item_groups_org_name").on(t.orgId, t.name),
  parentIdx: index("idx_item_groups_parent").on(t.parentGroupId),
}));

/**
 * Item "kinds" (goods, service, and any admin-defined custom types) — every
 * org is seeded with the two system types on creation; admins can add more
 * (e.g. "unprocessed") and set per-type whether an item group is mandatory.
 * items.kind stores this table's `name`, not a foreign key — same
 * plain-column self-reference convention used for accounts.parentAccountId.
 */
export const itemTypes = pgTable("item_types", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  isGroupMandatory: boolean("is_group_mandatory").notNull().default(true),
  /** System types (goods, service) can't be renamed or deleted. */
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgNameUnique: uniqueIndex("idx_item_types_org_name").on(t.orgId, t.name),
}));

/** FIFO cost lots. Purchases append lots; sales consume remainingQty oldest-first. */
export const stockLots = pgTable("stock_lots", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  itemId: integer("item_id").notNull(),
  warehouseId: integer("warehouse_id").notNull(),
  date: text("date").notNull(),
  qty: doublePrecision("qty").notNull(),
  remainingQty: doublePrecision("remaining_qty").notNull(),
  unitCostCents: money("unit_cost_cents").notNull(),
  sourceType: text("source_type").notNull(), // bill | opening | adjustment | transfer
  sourceId: integer("source_id"),
}, (t) => ({
  orgItemIdx: index("idx_stock_lots_org").on(t.orgId, t.itemId),
  orgWarehouseIdx: index("idx_stock_lots_warehouse").on(t.orgId, t.warehouseId),
}));

export const warehouses = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgIdx: index("idx_warehouses_org").on(t.orgId),
}));

/** Move stock between warehouses at the same weighted-average cost — no GL impact, inventory stays the same asset. */
export const stockTransfers = pgTable("stock_transfers", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  itemId: integer("item_id").notNull(),
  fromWarehouseId: integer("from_warehouse_id").notNull(),
  toWarehouseId: integer("to_warehouse_id").notNull(),
  qty: doublePrecision("qty").notNull(),
  unitCostCents: money("unit_cost_cents").notNull(),
  date: text("date").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgIdx: index("idx_stock_transfers_org").on(t.orgId),
}));

/**
 * Unified transactional documents.
 * type: quote | invoice | credit_note | bill | purchase_order | expense
 * status: draft | open | partial | paid | accepted | declined | closed | void
 */
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  type: text("type").notNull(),
  number: text("number").notNull(),
  contactId: integer("contact_id"),
  date: text("date").notNull(),
  dueDate: text("due_date"),
  status: text("status").notNull().default("draft"),
  isTemplate: boolean("is_template").notNull().default(false),
  taxInclusive: boolean("tax_inclusive").notNull().default(false),
  notes: text("notes"),
  subtotalCents: money("subtotal_cents").notNull().default(0),
  taxCents: money("tax_cents").notNull().default(0),
  totalCents: money("total_cents").notNull().default(0),
  paidCents: money("paid_cents").notNull().default(0),
  /** Sum of credit notes applied against this invoice — kept separate from paidCents
   * (real cash received) so cash-collected reports don't get inflated by non-cash credits. */
  creditedCents: money("credited_cents").notNull().default(0),
  sourceDocId: integer("source_doc_id"), // quote → invoice lineage
  journalEntryId: integer("journal_entry_id"),
  /** Events vertical: set when this quote/invoice belongs to a project's
   *  milestone payment schedule. Null for every ordinary SME document. */
  projectId: integer("project_id"),
  // eTIMS fields (populated on invoice issue by the TaxDevice)
  cuInvoiceNumber: text("cu_invoice_number"),
  cuSerial: text("cu_serial"),
  qrUrl: text("qr_url"),
  // expense-specific: paid-from bank account
  paidFromBankAccountId: integer("paid_from_bank_account_id"),
  /** Bills only, captured at creation so an admin approving remotely (SMS
   *  link, no login) can pay it out immediately without knowing the vendor's
   *  payout details themselves. Required at bill-creation time in the UI. */
  payoutDestination: text("payout_destination"),
  payoutDestinationType: text("payout_destination_type"), // phone | till | paybill
  payoutAccountNumber: text("payout_account_number"), // paybill account number only
  /**
   * Cost attribution for expenses/bills: which customer the cost was incurred
   * for, and the invoice it was rebilled on (if any). Distinct from contactId,
   * which is the vendor you paid — this is the customer you spent it for, so
   * job/customer profitability can be reported.
   */
  customerContactId: integer("customer_contact_id"),
  relatedInvoiceId: integer("related_invoice_id"),
  isBillable: boolean("is_billable").notNull().default(false),
  // set when a bill approval is rejected, shown back to the submitter
  approvalNote: text("approval_note"),
  // Snapshot of who created the document — survives staff renames/removal, shown on the PDF as "Sales Agent".
  createdByName: text("created_by_name"),
  createdByRole: text("created_by_role"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgTypeStatusIdx: index("idx_documents_org").on(t.orgId, t.type, t.status),
  contactIdx: index("idx_documents_contact").on(t.contactId),
  projectIdx: index("idx_documents_project").on(t.projectId),
}));

export const documentLines = pgTable("document_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  documentId: integer("document_id").notNull(),
  itemId: integer("item_id"),
  description: text("description").notNull(),
  qty: doublePrecision("qty").notNull().default(1),
  unitPriceCents: money("unit_price_cents").notNull().default(0),
  discountPct: doublePrecision("discount_pct").notNull().default(0),
  taxClass: text("tax_class").notNull().default("B16"),
  taxRateBp: integer("tax_rate_bp").notNull().default(1600), // basis points ×100 = 16.00%
  netCents: money("net_cents").notNull().default(0),
  taxCents: money("tax_cents").notNull().default(0),
  grossCents: money("gross_cents").notNull().default(0),
  accountId: integer("account_id"), // income/expense account override
  cogsCents: money("cogs_cents").notNull().default(0), // FIFO cost consumed (audit)
  position: integer("position").notNull().default(0),
  /** Section heading row — description holds the heading text, everything
   *  else stays zero. Purely presentational: contributes nothing to totals/
   *  VAT (computeDocument sums qty×price, which is 0 here), never has an
   *  itemId/accountId, and posting.ts skips it like any other zero-amount
   *  line — no changes needed there. */
  isHeading: boolean("is_heading").notNull().default(false),
  customColumnValue: text("custom_column_value"),
  costCenterId: integer("cost_center_id"), // optional dimension tag, flows into the posted journal line
  warehouseId: integer("warehouse_id"), // stock location for tracked items; null = org's default warehouse
  /** Purchase-order lines only: running total already billed via convertPoToBill, enabling partial receipt/billing. */
  billedQty: doublePrecision("billed_qty").notNull().default(0),
  /** Sold item's Bill of Materials FIFO consumption, JSON-encoded:
   *  [{componentItemId, usedQty, usedCostCents, wasteQty, wasteCostCents}, ...].
   *  Null for a normal (non-kit) line. Lets voidDocument restore the exact
   *  component lots/costs consumed instead of the wrong thing (there's no
   *  stock on the kit item itself to restore — the real consumption happened
   *  on its components). */
  bomConsumptionJson: text("bom_consumption_json"),
}, (t) => ({
  orgDocIdx: index("idx_document_lines_org").on(t.orgId, t.documentId),
}));

export const documentAssignments = pgTable("document_assignments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  documentId: integer("doc_id").notNull().references(() => documents.id),
  memberId: integer("member_id").notNull(), // can't reference members easily if it's below, we'll just store integer
  assignedById: integer("assigned_by_id"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgDocIdx: index("idx_document_assignments_org").on(t.orgId, t.documentId),
}));

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  number: text("number").notNull(),
  direction: text("direction").notNull(), // in (customer) | out (vendor)
  contactId: integer("contact_id"),
  documentId: integer("document_id"), // invoice or bill being settled
  date: text("date").notNull(),
  amountCents: money("amount_cents").notNull(), // gross amount applied to the document
  whtCents: money("wht_cents").notNull().default(0), // withheld income tax portion
  method: text("method").notNull().default("mpesa"), // mpesa | bank | cash | card | cheque
  bankAccountId: integer("bank_account_id"),
  reference: text("reference"),
  journalEntryId: integer("journal_entry_id"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgDocIdx: index("idx_payments_org").on(t.orgId, t.documentId),
}));

export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // bank | mpesa | cash | card
  accountId: integer("account_id").notNull(), // linked COA asset account
  openingBalanceCents: money("opening_balance_cents").notNull().default(0),
  openingBalanceDate: text("opening_balance_date"),
  openingBalanceEntryId: integer("opening_balance_entry_id"),
  archived: boolean("archived").notNull().default(false),
}, (t) => ({
  orgIdx: index("idx_bank_accounts_org").on(t.orgId),
}));

export const bankTransactions = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  bankAccountId: integer("bank_account_id").notNull(),
  date: text("date").notNull(),
  description: text("description").notNull(),
  amountCents: money("amount_cents").notNull(), // signed: + money in
  status: text("status").notNull().default("uncategorized"), // uncategorized | categorized | reconciled
  categoryAccountId: integer("category_account_id"),
  journalEntryId: integer("journal_entry_id"),
  externalRef: text("external_ref"), // e.g. M-Pesa receipt code — used to dedupe imports
  reconciliationId: integer("reconciliation_id"), // set when ticked in a completed reconciliation
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgCategoryIdx: index("idx_bank_txns_org").on(t.orgId, t.categoryAccountId),
}));

/** Append-only ledger. Only src/lib/posting.ts writes here. */
export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  date: text("date").notNull(),
  memo: text("memo"),
  sourceType: text("source_type").notNull(), // invoice | bill | payment | expense | manual | ...
  sourceId: integer("source_id"),
  reversalOfId: integer("reversal_of_id"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgIdx: index("idx_journal_entries_org").on(t.orgId),
}));

export const journalLines = pgTable("journal_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  entryId: integer("entry_id").notNull(),
  accountId: integer("account_id").notNull(),
  debitCents: money("debit_cents").notNull().default(0),
  creditCents: money("credit_cents").notNull().default(0),
  contactId: integer("contact_id"),
  memo: text("memo"),
  costCenterId: integer("cost_center_id"), // optional dimension: department / project / location
}, (t) => ({
  orgEntryAccountIdx: index("idx_journal_lines_org").on(t.orgId, t.entryId, t.accountId),
  costCenterIdx: index("idx_journal_lines_cost_center").on(t.orgId, t.costCenterId),
}));

/* ---------------- Team, permissions, dashboard ---------------- */

/** Staff accounts. Org owner (org.userId) is implicit admin. */
export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  userId: text("user_id").notNull().unique(), // Supabase auth uuid
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  // admin | accountant | sales | hr | inventory | staff
  role: text("role").notNull().default("staff"),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgIdx: index("idx_members_org").on(t.orgId),
}));

/** Per-role module visibility, editable by admin. Missing row = role default. */
export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  role: text("role").notNull(),
  permKey: text("perm_key").notNull(), // module key, e.g. "invoices"
  allowed: boolean("allowed").notNull().default(true),
});

export const todos = pgTable("todos", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  dueDate: text("due_date"),
  createdAt: text("created_at").notNull(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  title: text("title").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  color: text("color").notNull().default("#0f766e"),
  createdAt: text("created_at").notNull(),
});

/**
 * In-house team announcements posted by an admin within one org, readable by
 * whichever roles have the "announcements" permission. Distinct from the
 * platform-wide `announcements` table above (super-admin banner across every tenant).
 */
export const teamAnnouncements = pgTable("team_announcements", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  color: text("color").notNull().default("blue"), // banner color: blue | red | amber | green | purple | teal | pink | slate
  createdByName: text("created_by_name").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgIdx: index("idx_team_announcements_org").on(t.orgId),
}));

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  memberId: integer("member_id").references(() => members.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  link: text("link"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

/**
 * Learned bank categorization rules: "descriptions containing <keyword> →
 * book to <account>". Saved automatically when a user categorizes a
 * transaction, then applied to future imports. Editable by the user.
 */
export const categorizationRules = pgTable("categorization_rules", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  keyword: text("keyword").notNull(), // lowercase substring to match on description
  direction: text("direction").notNull().default("out"), // in | out
  categoryAccountId: integer("category_account_id").notNull(),
  hits: integer("hits").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

/* ---------------- Phase A: reconciliation & recurring ---------------- */

/**
 * A bank reconciliation session: tick imported/entered transactions until the
 * cumulative reconciled total equals the real statement balance, then complete.
 */
export const bankReconciliations = pgTable("bank_reconciliations", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  bankAccountId: integer("bank_account_id").notNull(),
  statementDate: text("statement_date").notNull(),
  statementBalanceCents: money("statement_balance_cents").notNull(),
  status: text("status").notNull().default("in_progress"), // in_progress | completed | cancelled
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});

export const mpesaTransactions = pgTable("mpesa_transactions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  receiptNumber: text("receipt_number").notNull(),
  date: text("date").notNull(),
  amountCents: money("amount_cents").notNull(),
  phoneNumber: text("phone_number").notNull(),
  customerName: text("customer_name").notNull(),
  status: text("status").notNull().default("unmatched"), // unmatched | matched
  matchedPaymentId: integer("matched_payment_id"), // links to payments.id
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgReceiptIdx: uniqueIndex("idx_mpesa_transactions_receipt").on(t.orgId, t.receiptNumber),
}));

export const recurringTemplates = pgTable("recurring_templates", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  docType: text("doc_type").notNull(), // invoice | bill | expense
  contactId: integer("contact_id"),
  frequency: text("frequency").notNull(), // weekly | monthly | quarterly | yearly
  nextRunDate: text("next_run_date").notNull(),
  autoIssue: boolean("auto_issue").notNull().default(false), // skip draft state
  taxInclusive: boolean("tax_inclusive").notNull().default(false),
  linesJson: text("lines_json").notNull(), // serialized Array<DocLineInput>
  active: boolean("active").notNull().default(true),
  lastRunAt: text("last_run_at"),
  dueInDays: integer("due_in_days").notNull().default(30),
  paidFromBankAccountId: integer("paid_from_bank_account_id"),
  notes: text("notes"),
  /** Staff member who owns this template — generated documents are assigned to them
   * (so they stay visible under data segregation) and only they get the run notification. */
  assignedMemberId: integer("assigned_member_id"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgNextRunIdx: index("idx_recurring_org_next").on(t.orgId, t.active, t.nextRunDate),
}));

export const fixedAssets = pgTable("fixed_assets", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  assetAccountId: integer("asset_account_id").notNull(),
  depreciationAccountId: integer("depreciation_account_id").notNull(),
  expenseAccountId: integer("expense_account_id").notNull(),
  purchaseDate: text("purchase_date").notNull(),
  purchaseCostCents: money("purchase_cost_cents").notNull(),
  salvageValueCents: money("salvage_value_cents").notNull().default(0),
  usefulLifeMonths: integer("useful_life_months").notNull(),
  depreciationMethod: text("depreciation_method").notNull().default("straight_line"),
  status: text("status").notNull().default("active"), // active | disposed
  /** Set when the purchase itself was recorded here (DR asset · CR bank) —
   *  null means the asset was registered without posting a purchase entry,
   *  e.g. because it was already recorded via a bill elsewhere and this
   *  registration exists purely to track depreciation. */
  paidFromBankAccountId: integer("paid_from_bank_account_id"),
  purchaseJournalEntryId: integer("purchase_journal_entry_id"),
  /** How the asset left the register — sale | scrap | trade — set on
   *  disposal so the register/audit trail records why, not just that it
   *  happened. Null while still active. */
  disposalType: text("disposal_type"),
  createdAt: text("created_at").notNull(),
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  kraPin: text("kra_pin"),
  nssfNumber: text("nssf_number"),
  shifNumber: text("shif_number"),
  basicSalaryCents: money("basic_salary_cents").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const payrollRuns = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  month: text("month").notNull(), // e.g. "2024-05"
  status: text("status").notNull().default("draft"), // draft | posting | posted
  journalEntryId: integer("journal_entry_id"), // once posted
  createdAt: text("created_at").notNull(),
});

export const payslips = pgTable("payslips", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRuns.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  grossPayCents: money("gross_pay_cents").notNull(),
  nssfCents: money("nssf_cents").notNull(),
  shifCents: money("shif_cents").notNull(),
  housingLevyCents: money("housing_levy_cents").notNull(),
  payeCents: money("paye_cents").notNull(),
  netPayCents: money("net_pay_cents").notNull(),
});

export const statutoryRules = pgTable("statutory_rules", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  type: text("type").notNull(), // PAYE, SHIF, NSSF_1, NSSF_2, AHL, RELIEF
  effectiveFrom: text("effective_from").notNull(), // YYYY-MM-DD
  effectiveTo: text("effective_to"), // YYYY-MM-DD or null
  calculationType: text("calculation_type").notNull(), // banded, flat_percent, capped, flat_amount
  parametersJson: text("parameters_json").notNull(), // serialized parameters
  createdAt: text("created_at").notNull(),
});

export const payrollRunLineItems = pgTable("payroll_run_line_items", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRuns.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  type: text("type").notNull(), // gross_pay, deduction, addition, net_pay
  subType: text("sub_type"), // PAYE, SHIF, NSSF, AHL, loan, adjustment
  amountCents: money("amount_cents").notNull(), // absolute value
  isDeduction: boolean("is_deduction").notNull().default(false),
  statutoryRuleId: integer("statutory_rule_id").references(() => statutoryRules.id),
});

export const customRoles = pgTable("custom_roles", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgNameIdx: uniqueIndex("idx_custom_roles_org_name").on(t.orgId, t.name),
}));

export const payrollAdjustments = pgTable("payroll_adjustments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  correctingRunId: integer("correcting_run_id").references(() => payrollRuns.id), 
  originalRunId: integer("original_run_id").references(() => payrollRuns.id), 
  amountCents: money("amount_cents").notNull(),
  isTaxable: boolean("is_taxable").notNull().default(true),
  isDeduction: boolean("is_deduction").notNull().default(false),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
});

export const loanLedger = pgTable("loan_ledger", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  principalCents: money("principal_cents").notNull(),
  balanceCents: money("balance_cents").notNull(),
  installmentCents: money("installment_cents").notNull(),
  type: text("type").notNull().default("amortizing"), // amortizing, recurring_fixed
  status: text("status").notNull().default("active"), // active, paid, paused
  /** Disbursement — DR Accounts Receivable (1200) · CR this bank/cash
   *  account. Recovery already credited AR on every payroll deduction (see
   *  payroll/runs/actions.ts) with no corresponding debit ever posted here,
   *  which meant recovering a staff loan quietly drove AR negative forever.
   *  Null when a loan predates this (or was deliberately not disbursed
   *  through the org's own books — e.g. a pre-existing balance). */
  disbursedFromBankAccountId: integer("disbursed_from_bank_account_id"),
  disbursementJournalEntryId: integer("disbursement_journal_entry_id"),
  createdAt: text("created_at").notNull(),
});

export const loanInstallments = pgTable("loan_installments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  loanId: integer("loan_id").notNull().references(() => loanLedger.id),
  payrollRunId: integer("payroll_run_id").notNull().references(() => payrollRuns.id),
  amountCents: money("amount_cents").notNull(),
  createdAt: text("created_at").notNull(),
});

export const leaveRecords = pgTable("leave_records", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  month: text("month").notNull(), // e.g. "2024-05"
  unpaidDaysCount: integer("unpaid_days_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const paymentGateways = pgTable("payment_gateways", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  gatewayId: text("gateway_id").notNull(), // mpesa_daraja, kopokopo
  enabled: boolean("enabled").notNull().default(false),
  environment: text("environment").notNull().default("sandbox"), // sandbox | production
  configJson: text("config_json"), // encrypted json string
  webhookSecret: text("webhook_secret"), // random token embedded in callback URLs
  c2bRegisteredAt: text("c2b_registered_at"), // when paybill C2B URLs were registered with Safaricom
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
}, (t) => ({
  orgGatewayIdx: index("idx_payment_gateways_org").on(t.orgId, t.gatewayId),
}));

/**
 * Provider-side payout recipients, cached by destination.
 *
 * Kopo Kopo rejects creating a recipient that already exists for a phone
 * number — with a generic "Pay recipient could not be created" — and offers no
 * endpoint to look one up. So the reference has to be remembered on first
 * creation, or that destination becomes permanently unpayable.
 */
export const payoutRecipients = pgTable("payout_recipients", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  gatewayId: text("gateway_id").notNull(),
  destination: text("destination").notNull(), // normalized phone/till
  providerRef: text("provider_ref").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  lookupIdx: uniqueIndex("idx_payout_recipients_lookup").on(t.orgId, t.gatewayId, t.destination),
}));

export const paymentEvents = pgTable("payment_events", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  gatewayId: text("gateway_id").notNull(),
  providerRef: text("provider_ref").notNull(),
  amountCents: money("amount_cents").notNull(),
  payerPhone: text("payer_phone"),
  payerName: text("payer_name"),
  accountRef: text("account_ref"),
  direction: text("direction").notNull().default("in"), // in (customer payment) | out (payout)
  status: text("status").notNull().default("received"), // pending | received | matched | unmatched | applied | failed | amount_mismatch
  matchedDocumentId: integer("matched_document_id"), // if matched to invoice
  matchedExpenseClaimId: integer("matched_expense_claim_id"), // if matched to a staff expense claim payout
  paymentId: integer("payment_id"), // if applied (points to customer_payments)
  rawJson: text("raw_json"), // JSON payload from provider
  createdAt: text("created_at").notNull(),
}, (t) => ({
  gatewayRefUnique: uniqueIndex("idx_payment_events_gateway_ref").on(t.gatewayId, t.providerRef),
}));

export const receiptTokens = pgTable("receipt_tokens", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  paymentId: integer("payment_id").notNull().references(() => payments.id),
  token: text("token").notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  tokenUnique: uniqueIndex("idx_receipt_tokens_token").on(t.token),
  paymentUnique: uniqueIndex("idx_receipt_tokens_payment").on(t.paymentId),
}));

export const smsSettings = pgTable("sms_settings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  provider: text("provider").notNull().default("advanta"),
  enabled: boolean("enabled").notNull().default(false),
  configJson: text("config_json"), // encrypted: apiKey, partnerId, senderId
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
}, (t) => ({
  orgUnique: uniqueIndex("idx_sms_settings_org").on(t.orgId),
}));

export const smsLog = pgTable("sms_log", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  paymentId: integer("payment_id"), // set for receipt SMS — dedupe key
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(), // sent | failed
  providerRef: text("provider_ref"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  paymentUnique: uniqueIndex("idx_sms_log_payment").on(t.paymentId),
}));

export const portalOtps = pgTable("portal_otps", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  phone: text("phone").notNull(), // normalized 254XXXXXXXXX
  codeHash: text("code_hash").notNull(), // sha256(code + token pepper)
  attempts: integer("attempts").notNull().default(0),
  consumed: boolean("consumed").notNull().default(false),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgPhoneIdx: index("idx_portal_otps_org_phone").on(t.orgId, t.phone),
}));

export const reminderLog = pgTable("reminder_log", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  documentId: integer("document_id").notNull().references(() => documents.id),
  kind: text("kind").notNull(), // overdue_1 | overdue_7 | overdue_14
  sentAt: text("sent_at").notNull(),
}, (t) => ({
  docKindUnique: uniqueIndex("idx_reminder_log_doc_kind").on(t.documentId, t.kind),
}));

export const approvalRequestTokens = pgTable("approval_request_tokens", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  documentId: integer("document_id").notNull().references(() => documents.id),
  token: text("token").notNull(),
  channel: text("channel").notNull().default("sms"),
  recipient: text("recipient"),
  decision: text("decision"), // approved | rejected
  note: text("note"),
  actedAt: text("acted_at"),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  tokenUnique: uniqueIndex("idx_approval_request_tokens_token").on(t.token),
  orgDocIdx: index("idx_approval_request_tokens_doc").on(t.orgId, t.documentId),
}));

/**
 * A separate table (not approvalRequestTokens — that FKs documentId to
 * `documents`, which expense claims aren't) for expense-claim gateway
 * payouts that exceed an accountant's payout limit. The full payout
 * request (destination/amount/gateway) is captured here at request time
 * so the admin's approve action can execute exactly what was asked for,
 * without trusting anything re-submitted from the click.
 */
export const expenseClaimPayoutApprovals = pgTable("expense_claim_payout_approvals", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  claimId: integer("claim_id").notNull().references(() => expenseClaims.id),
  token: text("token").notNull(),
  requestedByName: text("requested_by_name").notNull(),
  destination: text("destination").notNull(),
  destinationType: text("destination_type").notNull(),
  accountNumber: text("account_number"),
  amountCents: money("amount_cents").notNull(),
  gatewayId: text("gateway_id").notNull(),
  recipient: text("recipient"),
  decision: text("decision"), // approved | rejected
  note: text("note"),
  actedAt: text("acted_at"),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  tokenUnique: uniqueIndex("idx_expclaim_payout_approvals_token").on(t.token),
  claimIdx: index("idx_expclaim_payout_approvals_claim").on(t.orgId, t.claimId),
}));

export const portalSessions = pgTable("portal_sessions", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  phone: text("phone").notNull(),
  token: text("token").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  tokenUnique: uniqueIndex("idx_portal_sessions_token").on(t.token),
}));

export const portalUsers = pgTable("portal_users", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  contactId: integer("contact_id").notNull().references(() => contacts.id),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgContactIdx: index("idx_portal_users_org_contact").on(t.orgId, t.contactId),
  emailUnique: uniqueIndex("idx_portal_users_email").on(t.orgId, t.email),
}));

export const knowledgeArticles = pgTable("knowledge_articles", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  published: boolean("published").notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgIdx: index("idx_knowledge_articles_org").on(t.orgId),
}));

/** Platform super admins — global, not org-scoped. Env SUPER_ADMIN_EMAILS remains the bootstrap fallback. */
export const superAdmins = pgTable("super_admins", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  addedBy: text("added_by"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  emailUnique: uniqueIndex("idx_super_admins_email").on(t.email),
}));

/** Audit trail of super admin actions (impersonation, plan changes, admin management). */
export const adminAuditLog = pgTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(), // impersonate_start | impersonate_stop | plan_change | paid_until_extend | super_admin_add | super_admin_remove
  targetType: text("target_type"), // org | super_admin
  targetId: text("target_id"),
  detail: text("detail"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  createdIdx: index("idx_admin_audit_created").on(t.createdAt),
}));

/** Per-org business action trail — who did what, when, on which record. Admin-only, org-isolated. */
export const orgAuditLog = pgTable("org_audit_log", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  actorMemberId: integer("actor_member_id"), // null when the actor is the org owner
  actorName: text("actor_name").notNull(),
  actorRole: text("actor_role").notNull(), // owner | admin | accountant | sales | ...
  action: text("action").notNull(), // create | update | delete | issue | void | approve | reject | login-affecting change, etc.
  module: text("module").notNull(), // contacts | invoices | quotes | bills | payments | staff | settings | ...
  recordId: integer("record_id"),
  recordLabel: text("record_label"), // human label snapshotted at write time, e.g. "INV-0042" — survives the record later being renamed/deleted
  detail: text("detail"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgCreatedIdx: index("idx_org_audit_org_created").on(t.orgId, t.createdAt),
  orgModuleIdx: index("idx_org_audit_org_module").on(t.orgId, t.module),
}));

/** AI assistant chat — history scoped to the Nairobi calendar day; old days are kept (not deleted) but not surfaced by default. */
export const aiMessages = pgTable("ai_messages", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  memberId: integer("member_id"), // null when the actor is the org owner
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  toolCalls: text("tool_calls"), // JSON: [{tool, args, result | pendingAction}], null for plain text turns
  nairobiDate: text("nairobi_date").notNull(), // YYYY-MM-DD in Africa/Nairobi — what "today" filtering keys on
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgMemberDateIdx: index("idx_ai_messages_org_member_date").on(t.orgId, t.memberId, t.nairobiDate),
}));

/** Platform-wide announcements shown as a banner in every tenant's app. */
export const announcements = pgTable("announcements", {
  id: serial("id").primaryKey(),
  message: text("message").notNull(),
  tone: text("tone").notNull().default("info"), // info | warn
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull(),
});

/** Execution history for scheduled jobs (recurring documents, due-date alerts). */
export const cronRuns = pgTable("cron_runs", {
  id: serial("id").primaryKey(),
  job: text("job").notNull(), // recurring | due-dates
  status: text("status").notNull(), // success | error
  detail: text("detail"),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  jobCreatedIdx: index("idx_cron_runs_job_created").on(t.job, t.createdAt),
}));

/** Per-org boolean feature overrides — grants a plan-gated feature regardless of plan (beta/pilot tool). */
export const featureFlags = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  flag: text("flag").notNull(), // gateways | sms | payouts | portal | recurring | payroll
  createdBy: text("created_by"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgFlagUnique: uniqueIndex("idx_feature_flags_org_flag").on(t.orgId, t.flag),
}));

/** Zeno's own subscription payments, collected via IntaSend STK push. */
export const billingPayments = pgTable("billing_payments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  plan: text("plan").notNull(), // standard | business
  cycle: text("cycle").notNull(), // monthly | annual
  amountCents: money("amount_cents").notNull(),
  /** "mpesa" (STK push, requires phone) or "card" (hosted checkout, requires email). */
  method: text("method").notNull().default("mpesa"),
  phone: text("phone"),
  email: text("email"),
  /** IntaSend invoice_id — used to poll status and match webhooks. */
  invoiceId: text("invoice_id"),
  state: text("state").notNull().default("PENDING"), // PENDING | PROCESSING | COMPLETE | FAILED | applied
  failedReason: text("failed_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
}, (t) => ({
  orgIdx: index("idx_billing_payments_org").on(t.orgId),
  invoiceUnique: uniqueIndex("idx_billing_payments_invoice").on(t.invoiceId),
}));

/** Staff-submitted expense claims for reimbursement — separate from vendor bills/expenses. */
export const expenseClaims = pgTable("expense_claims", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  memberId: integer("member_id"), // submitter — null if the owner themselves submitted
  submittedByName: text("submitted_by_name").notNull(),
  date: text("date").notNull(),
  categoryAccountId: integer("category_account_id").notNull(), // expense account to debit
  description: text("description").notNull(),
  amountCents: money("amount_cents").notNull(),
  receiptUrl: text("receipt_url"),
  /** Where the claimant wants to be reimbursed (M-Pesa number, most often)
   *  — collected at submission time so whoever pays it out via gateway
   *  isn't left guessing/asking separately; pre-fills but doesn't lock the
   *  destination field on the payout form. */
  payoutPhone: text("payout_phone"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | paid
  reviewedByName: text("reviewed_by_name"),
  reviewNote: text("review_note"),
  journalEntryId: integer("journal_entry_id"), // set on approval (DR expense · CR payable)
  paidJournalEntryId: integer("paid_journal_entry_id"), // set on payout (DR payable · CR bank)
  bankAccountId: integer("bank_account_id"), // set once paid
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
  paidAt: text("paid_at"),
}, (t) => ({
  orgStatusIdx: index("idx_expense_claims_org_status").on(t.orgId, t.status),
}));

/** Staff leave requests (annual, sick, unpaid, etc). */
export const leaveRequests = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  memberId: integer("member_id"), // requester — null if the owner themselves requested
  requestedByName: text("requested_by_name").notNull(),
  leaveType: text("leave_type").notNull(), // annual | sick | unpaid | maternity | paternity | compassionate | other
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  reviewedByName: text("reviewed_by_name"),
  adminNote: text("admin_note"),
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
}, (t) => ({
  orgStatusIdx: index("idx_leave_requests_org_status").on(t.orgId, t.status),
}));

/** Staff clock in/out shifts. */
export const timeShifts = pgTable("time_shifts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  memberId: integer("member_id"), // null = the org owner clocked in
  personName: text("person_name").notNull(),
  clockInAt: text("clock_in_at").notNull(), // ISO timestamp
  clockOutAt: text("clock_out_at"), // ISO timestamp, null while active
  durationSeconds: integer("duration_seconds"), // set on clock-out
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgOpenIdx: index("idx_time_shifts_org_open").on(t.orgId, t.clockOutAt),
  orgMemberIdx: index("idx_time_shifts_org_member").on(t.orgId, t.memberId),
}));

/** Reporting dimension: department / project / location tag on journal lines. */
export const costCenters = pgTable("cost_centers", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  code: text("code"),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgIdx: index("idx_cost_centers_org").on(t.orgId),
}));

/** Batch vendor payment run — select open bills, pay them together from one bank account. */
export const paymentRuns = pgTable("payment_runs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  date: text("date").notNull(),
  bankAccountId: integer("bank_account_id").notNull(),
  method: text("method").notNull().default("bank"), // mpesa | bank | cash | card | cheque
  status: text("status").notNull().default("draft"), // draft | posting | posted
  totalCents: money("total_cents").notNull().default(0),
  createdAt: text("created_at").notNull(),
  postedAt: text("posted_at"),
}, (t) => ({
  orgIdx: index("idx_payment_runs_org").on(t.orgId),
}));

export const paymentRunItems = pgTable("payment_run_items", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  runId: integer("run_id").notNull().references(() => paymentRuns.id),
  billId: integer("bill_id").notNull(),
  amountCents: money("amount_cents").notNull(),
  paymentId: integer("payment_id"), // set once posted (points at the `payments` row created)
  status: text("status").notNull().default("pending"), // pending | paid | failed
  failReason: text("fail_reason"),
}, (t) => ({
  orgRunIdx: index("idx_payment_run_items_run").on(t.orgId, t.runId),
}));

/** A named budget for a fiscal year — one set of monthly targets per account. */
export const budgets = pgTable("budgets", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  name: text("name").notNull(),
  fiscalYear: text("fiscal_year").notNull(), // e.g. "2026"
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgIdx: index("idx_budgets_org").on(t.orgId),
}));

export const budgetLines = pgTable("budget_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  budgetId: integer("budget_id").notNull().references(() => budgets.id),
  accountId: integer("account_id").notNull(),
  month: text("month").notNull(), // "2026-01"
  amountCents: money("amount_cents").notNull().default(0),
}, (t) => ({
  orgBudgetIdx: index("idx_budget_lines_budget").on(t.orgId, t.budgetId),
  budgetAccountMonthUnique: uniqueIndex("idx_budget_lines_unique").on(t.budgetId, t.accountId, t.month),
}));

/** One row per (org, named integrity check) — the ledger-integrity cron
 *  upserts these every run so the super admin sees drift across every org's
 *  books without having to manually audit each one, the way the expense-
 *  claim account bug and its own broken reconciliation tool both had to be
 *  found by hand this session. resolvedAt is cleared whenever the check
 *  fails again and set the moment a run no longer reproduces it — so the
 *  admin screen only ever shows what's currently wrong, not history noise. */
export const ledgerIntegrityFindings = pgTable("ledger_integrity_findings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  checkKey: text("check_key").notNull(),
  severity: text("severity").notNull().default("error"), // error | warning
  message: text("message").notNull(),
  detail: text("detail"),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  resolvedAt: text("resolved_at"),
}, (t) => ({
  orgCheckUnique: uniqueIndex("idx_ledger_integrity_org_check").on(t.orgId, t.checkKey),
  unresolvedIdx: index("idx_ledger_integrity_unresolved").on(t.resolvedAt),
}));

/**
 * ---------------------------------------------------------------------
 * Events vertical (Zeno Events) — projects, instance-tracked inventory,
 * milestone billing, and photo-verified damage reporting. Additive only:
 * nothing above this line is touched. See docs/ZENO_EVENTS.md-equivalent
 * proposal for the full picture; this is the Phase 0/1 schema slice.
 * ---------------------------------------------------------------------
 */

/** One row per event — the hub every other events-module table hangs off. */
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  contactId: integer("contact_id"), // the client
  name: text("name").notNull(),
  eventType: text("event_type"), // wedding | corporate | gala | other — free text, not enforced
  venue: text("venue"),
  colorTheme: text("color_theme"), // client's decor color scheme, e.g. "Sage green & gold" — free text
  eventDate: text("event_date").notNull(),
  status: text("status").notNull().default("lead"), // lead | quoted | confirmed | in_progress | completed | cancelled
  budgetCents: money("budget_cents").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgStatusIdx: index("idx_projects_org").on(t.orgId, t.status),
  contactIdx: index("idx_projects_contact").on(t.contactId),
  eventDateIdx: index("idx_projects_event_date").on(t.orgId, t.eventDate),
}));

/** Instance- or batch-level record for durable, rentable gear (chairs,
 *  tents, AV) — distinct from the FIFO consumable stock in stockLots.
 *  itemId points at the catalog item (e.g. "Chiavari Chair"); this row is
 *  one trackable unit or labeled batch of it, with its own location and
 *  lifecycle state. */
export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  itemId: integer("item_id").notNull(),
  label: text("label").notNull(), // e.g. "Set B" or a serial number
  qty: doublePrecision("qty").notNull().default(1), // batch size — 1 for a serialized unit, >1 for a labeled batch
  condition: text("condition").notNull().default("good"), // good | worn | damaged | written_off
  status: text("status").notNull().default("in_store"), // in_store | reserved | dispatched | at_event | returned | damaged | on_external_hire
  warehouseId: integer("warehouse_id"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgItemIdx: index("idx_inventory_items_org_item").on(t.orgId, t.itemId),
  statusIdx: index("idx_inventory_items_status").on(t.orgId, t.status),
}));

/** Ties an inventory item to a project across a date range — this is the
 *  conflict-check surface: two reservations for the same item with
 *  overlapping ranges is the "chairs double-booked" problem made queryable. */
export const reservations = pgTable("reservations", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItems.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  qty: doublePrecision("qty").notNull().default(1), // portion of a batch this project holds
  startDate: text("start_date").notNull(), // dispatch date
  endDate: text("end_date").notNull(), // expected return date
  location: text("location"), // which zone of the venue this booking goes to, e.g. "Main Arena" — per-booking, not the item's catalog category or its storage warehouse
  status: text("status").notNull().default("booked"), // booked | dispatched | returned | cancelled
  createdAt: text("created_at").notNull(),
}, (t) => ({
  itemDatesIdx: index("idx_reservations_item_dates").on(t.inventoryItemId, t.startDate, t.endDate),
  projectIdx: index("idx_reservations_project").on(t.projectId),
}));

/** Milestone template set at project confirmation. Generates real invoices
 *  (documents rows, type='invoice', projectId set) as each milestone comes
 *  due — reuses the existing invoice engine rather than a parallel one. */
export const paymentSchedule = pgTable("payment_schedule", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  milestoneName: text("milestone_name").notNull(), // "Booking Deposit", "Final Balance"...
  triggerType: text("trigger_type").notNull(), // fixed_date | days_before_event | on_confirmation
  triggerValue: text("trigger_value"), // ISO date for fixed_date, integer-as-text for days_before_event
  amountType: text("amount_type").notNull(), // percentage | fixed
  percentageValue: doublePrecision("percentage_value"), // set when amountType = 'percentage', e.g. 30 for 30%
  fixedAmountCents: money("fixed_amount_cents"), // set when amountType = 'fixed'
  sequenceOrder: integer("sequence_order").notNull().default(0),
  documentId: integer("document_id"), // set once the milestone's invoice has been generated
  createdAt: text("created_at").notNull(),
}, (t) => ({
  projectIdx: index("idx_payment_schedule_project").on(t.projectId),
}));

/** Client service agreement for an event — separate from `documents`
 *  since it's not a financial/ledger record. "Signing" it means uploading
 *  a photo of the printed, wet-ink-signed copy (same real-world pattern as
 *  damageReports.photoUrl), not a canvas e-signature pad. */
export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  subject: text("subject").notNull(),
  valueCents: money("value_cents").notNull().default(0),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  status: text("status").notNull().default("draft"), // draft | sent | signed | declined | expired
  content: text("content"), // plain-text terms
  signaturePhotoPath: text("signature_photo_path"), // storage path — private bucket, signed URL on read
  signedAt: text("signed_at"),
  signedByName: text("signed_by_name"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgProjectIdx: index("idx_contracts_org_project").on(t.orgId, t.projectId),
  statusIdx: index("idx_contracts_org_status").on(t.orgId, t.status),
}));

/** Photo-backed liability record, one per damaged/missing unit. No row can
 *  represent a "Damaged" status without a photoUrl — enforced in the UI/
 *  action layer (camera-only capture), not the DB, same as other required-
 *  attachment flows in this codebase. */
export const damageReports = pgTable("damage_reports", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItems.id),
  projectId: integer("project_id"), // null for a hire-out return not tied to an internal project
  reservationId: integer("reservation_id"),
  reportedByMemberId: integer("reported_by_member_id"),
  damageType: text("damage_type").notNull(), // broken | chipped | stained | missing | other
  description: text("description"),
  photoUrl: text("photo_url").notNull(),
  stageReported: text("stage_reported").notNull(), // loading | collection | inspection
  liabilityStatus: text("liability_status").notNull().default("pending"), // pending | staff_fault | client_fault | wear_and_tear | unresolved
  resolvedByMemberId: integer("resolved_by_member_id"),
  resolvedAt: text("resolved_at"),
  billedToClient: boolean("billed_to_client").notNull().default(false),
  billedAmountCents: money("billed_amount_cents").notNull().default(0),
  documentId: integer("document_id"), // invoice the billed amount flowed into
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgStatusIdx: index("idx_damage_reports_org_status").on(t.orgId, t.liabilityStatus),
  itemIdx: index("idx_damage_reports_item").on(t.inventoryItemId),
  orgProjectIdx: index("idx_damage_reports_org_project").on(t.orgId, t.projectId),
}));

/** External hire-out — the org's own gear rented to another event company.
 *  Shares the same inventoryItems status machine (on_external_hire) but is
 *  a distinct contract type from an internal project. */
export const hireContracts = pgTable("hire_contracts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  inventoryItemId: integer("inventory_item_id").notNull().references(() => inventoryItems.id),
  qty: doublePrecision("qty").notNull().default(1),
  externalClientName: text("external_client_name").notNull(),
  externalClientPhone: text("external_client_phone"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  actualReturnDate: text("actual_return_date"),
  hireFeeCents: money("hire_fee_cents").notNull().default(0),
  depositCents: money("deposit_cents").notNull().default(0),
  depositReturned: boolean("deposit_returned").notNull().default(false),
  status: text("status").notNull().default("out"), // out | returned | overdue
  documentId: integer("document_id"), // optional invoice for the hire fee
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgStatusIdx: index("idx_hire_contracts_org_status").on(t.orgId, t.status),
  itemIdx: index("idx_hire_contracts_item").on(t.inventoryItemId),
}));

/**
 * One manifest per project — the dispatch/return checklist that turns
 * "we reserved this gear" into "it's actually loaded, at the venue, and
 * back." Manifest-level status is deliberately coarse (draft/confirmed/
 * in_progress/reconciled); the real per-item granularity — who picked,
 * loaded, dispatched, collected, returned, and inspected each line, and
 * when — lives on manifestLines below. This is what the loading/warehouse/
 * collection staff roles actually work off day to day.
 */
export const manifests = pgTable("manifests", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  status: text("status").notNull().default("draft"), // draft | confirmed | in_progress | reconciled
  assignedLoadingMemberId: integer("assigned_loading_member_id"),
  assignedWarehouseMemberId: integer("assigned_warehouse_member_id"),
  assignedCollectionMemberId: integer("assigned_collection_member_id"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  confirmedAt: text("confirmed_at"),
  reconciledAt: text("reconciled_at"),
}, (t) => ({
  orgProjectUnique: uniqueIndex("idx_manifests_org_project").on(t.orgId, t.projectId),
  orgStatusIdx: index("idx_manifests_org_status").on(t.orgId, t.status),
}));

/** One row per item on a manifest — durable gear (tied to a specific
 *  inventoryItems instance/batch) or a consumable (quoted qty vs. actual
 *  qty used, no pack/dispatch/return legs). status walks pending -> picked
 *  -> loaded -> dispatched -> collected -> returned -> one of the
 *  inspected_* terminal outcomes. inspected_damaged/inspected_missing link
 *  to a damageReports row (photo required — see damage-reports.ts) rather
 *  than duplicating that flow here. */
export const manifestLines = pgTable("manifest_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => org.id),
  manifestId: integer("manifest_id").notNull().references(() => manifests.id),
  lineType: text("line_type").notNull(), // durable | consumable
  inventoryItemId: integer("inventory_item_id"), // durable lines
  itemId: integer("item_id"), // catalog item — consumable lines, and descriptive for durable
  description: text("description").notNull(),
  qtyRequested: doublePrecision("qty_requested").notNull().default(1),
  qtyUsed: doublePrecision("qty_used"), // consumables — actual usage, set at reconciliation
  location: text("location"), // copied from the source reservation at manifest creation — which venue zone this line goes to
  status: text("status").notNull().default("pending"),
  checkedByMemberId: integer("checked_by_member_id"),
  checkedAt: text("checked_at"),
  notes: text("notes"),
  damageReportId: integer("damage_report_id"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  orgManifestIdx: index("idx_manifest_lines_org_manifest").on(t.orgId, t.manifestId),
  inventoryItemIdx: index("idx_manifest_lines_inventory_item").on(t.inventoryItemId),
}));
