/**
 * Single source of truth for the Zeno Events system guide — rendered both
 * as the in-app /docs/guide page and as the downloadable PDF (see
 * scripts/generate-guide-pdf.tsx). Keep content here, not duplicated in
 * either renderer, so the two never drift out of sync.
 */

export interface GuideStep {
  title: string;
  detail: string;
}

export interface GuideSection {
  number: string; // "08" etc — also used as the anchor id
  title: string;
  subtitle?: string;
  tags: string[];
  roles: string[]; // role labels, matches ROLE_LABELS keys where possible
  summary: string;
  keyConcepts?: string[];
  steps?: GuideStep[];
  note?: string; // a highlighted callout — edge case, permission gate, warning
  crossRefs?: string[]; // section numbers
  screenshotCaption?: string; // caption shown under the screenshot (or, if no screenshot file, what one would show)
  screenshot?: string; // filename in public/docs/screenshots/ — regenerate via scripts/capture-screenshots.ts
}

export const GUIDE_META = {
  title: "The Complete Zeno Guide",
  subtitle: "Running an events company on Zeno — every module, every role, start to finish.",
  version: "1.0",
};

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin / Owner",
  accountant: "Accountant",
  sales: "Sales",
  hr: "HR",
  inventory: "Inventory",
  staff: "General Staff",
  loading_staff: "Loading Staff",
  warehouse_staff: "Warehouse Staff",
  collection_staff: "Collection Staff",
};

/** Mirrors src/lib/access.ts DEFAULT_ROLE_PERMS — kept as plain labels here
 *  since this file has no reason to import the server-only access module. */
export const ROLE_MATRIX: { module: string; roles: string[] }[] = [
  { module: "Home dashboard", roles: ["admin", "accountant", "sales", "hr", "inventory", "staff", "loading_staff", "warehouse_staff", "collection_staff"] },
  { module: "Customers & Vendors", roles: ["admin", "accountant", "sales", "hr", "inventory"] },
  { module: "Leads", roles: ["admin", "accountant", "sales"] },
  { module: "Deals pipeline", roles: ["admin", "accountant", "sales"] },
  { module: "Quotes & templates", roles: ["admin", "accountant", "sales"] },
  { module: "Invoices, templates & credit notes", roles: ["admin", "accountant", "sales"] },
  { module: "Expenses", roles: ["admin", "accountant", "inventory"] },
  { module: "Expense claims", roles: ["admin", "accountant", "sales", "hr", "inventory", "staff", "loading_staff", "warehouse_staff", "collection_staff"] },
  { module: "Bills & purchase orders", roles: ["admin", "accountant", "inventory"] },
  { module: "Items & Stock", roles: ["admin", "accountant", "sales", "inventory", "warehouse_staff"] },
  { module: "Projects (Events)", roles: ["admin", "accountant", "sales", "inventory", "staff"] },
  { module: "Contracts", roles: ["admin", "accountant", "sales", "inventory", "staff"] },
  { module: "Manifests (My Tasks)", roles: ["admin", "accountant", "inventory", "loading_staff", "warehouse_staff", "collection_staff"] },
  { module: "Bank & M-Pesa", roles: ["admin", "accountant"] },
  { module: "Payroll", roles: ["admin", "hr"] },
  { module: "Fixed Assets", roles: ["admin", "accountant"] },
  { module: "Accountant (ledger)", roles: ["admin", "accountant"] },
  { module: "Reports & Analytics", roles: ["admin", "accountant", "hr"] },
  { module: "Settings", roles: ["admin"] },
  { module: "Staff & Roles", roles: ["admin"] },
];

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    number: "01",
    title: "How This Guide Works",
    tags: ["orientation"],
    roles: ["Everyone"],
    summary:
      "This is the complete guide to running an events company on Zeno — every module, in the order a real booking actually moves through them, written for every role in the org, not just admins.",
    keyConcepts: [
      "Each section covers one part of the system: what it's for, the ideas you need to understand it, and the exact steps to use it.",
      "Tags at the top of each section tell you which area of the business it belongs to — Sales, Inventory, Money, Operations, Admin.",
      "Roles tells you who this section matters to. If your role isn't listed, you likely won't see that menu item at all — that's by design, not a mistake.",
      "Cross-references point to related sections, since almost nothing in Zeno works in isolation — a quote becomes an invoice, an invoice can trigger a reservation, a reservation shows up on a manifest.",
    ],
    note:
      "Zeno is built around one idea: a Project is the hub. Everything else — quotes, invoices, inventory, contracts, payments — hangs off a Project. Keep that in mind and the rest of the system reads as one connected story instead of a list of separate tools.",
  },
  {
    number: "02",
    title: "The Big Picture",
    subtitle: "How every part of Zeno connects",
    tags: ["orientation", "architecture"],
    roles: ["Everyone"],
    summary:
      "A booking moves through Zeno in a predictable line. Understanding this flow once means every other section in this guide slots into a picture you already have.",
    keyConcepts: [
      "Lead → Project. A lead comes in through a capture channel (website, Instagram, QR code, referral, or a staff member typing it in). Converting a lead creates a Contact and a Project.",
      "Project → Quote → Invoice. A quote is drafted against the Project, sent to the client, and — once accepted — converted into an invoice. The invoice stays linked to the same Project throughout.",
      "Project status auto-advances. Sending a quote moves the Project to Quoted. Accepting a quote, converting it to an invoice, or issuing an invoice directly all move the Project to Confirmed — automatically, no manual click required.",
      "Confirmed → Reservations. The moment a Project is confirmed, any Event Inventory items on its invoice that map to exactly one unambiguous rental batch are auto-reserved for the event date. Ambiguous or unavailable items are left for staff to reserve manually.",
      "Reservations → Manifest. A confirmed Project's reservations become a dispatch manifest — the pick/load/dispatch/collect/return/inspect checklist your warehouse and loading staff work off.",
      "Invoice paid + Manifest reconciled → Completed. A Project only auto-completes once both conditions are true: every real invoice is fully paid, and (if the project used inventory) the manifest is fully reconciled. Either one alone isn't enough — a fully-paid invoice with gear still out in the field isn't actually done.",
      "Contracts run alongside, not inside, this chain. A contract is client-facing paperwork tied to the same Project — it can be signed independently of where the booking is in its financial lifecycle.",
      "The Client Portal is a second, parallel application. Your staff use the main app described in this guide; your clients use a separate portal (their own login) that shows only their own Projects, documents, and contracts — never your internal costs, margins, or other clients' data.",
    ],
    crossRefs: ["08", "09", "10", "11", "13", "14"],
  },
  {
    number: "03",
    title: "Roles & What Each One Sees",
    tags: ["admin", "orientation"],
    roles: ["Admin / Owner"],
    summary:
      "Every staff account has exactly one role (plus any custom roles the admin creates), and every role has a fixed list of modules it can see. The sidebar isn't the same for everyone — that's intentional.",
    keyConcepts: [
      "Nine built-in roles ship with Zeno: Admin, Accountant, Sales, HR, Inventory, general Staff, and three operational roles built specifically for event logistics — Loading Staff, Warehouse Staff, and Collection Staff.",
      "The three operational roles are deliberately narrow: they see a mobile-friendly checklist (Manifests, i.e. \"My Tasks\") and almost nothing else. That's the point — a loading crew member doesn't need to see pricing or contracts to do their job well.",
      "Admins can create additional custom roles from Staff & Roles, and can toggle exactly which modules any role — built-in or custom — can see, per organization.",
      "The table below is the default starting point every new organization gets. An admin can adjust it at any time without touching code.",
    ],
    crossRefs: ["19"],
  },
  {
    number: "04",
    title: "Home Dashboard",
    tags: ["operations", "daily-use"],
    roles: ["Everyone"],
    summary:
      "The dashboard is the first thing everyone sees on login — a live snapshot of the business, tuned to events: this week's bookings, cash position, manifest pipeline, and anything that needs attention today.",
    keyConcepts: [
      "Admins and accountants see the full picture: money owed, money in the bank, the manifest pipeline (how many jobs are draft/confirmed/packing/loaded/dispatched/returned/inspected), and a calendar with every project, invoice due date, and recurring run on it.",
      "Everyone else sees a narrower, personal view — their own assigned documents and tasks, not the whole org's financial picture.",
      "The calendar's day cells get visibly busier (a background tint) the more events land on the same day — an early warning for double-booking risk before it becomes a real conflict.",
      "A red banner surfaces unpaid milestones automatically — money that should have come in by now but hasn't.",
    ],
    steps: [
      { title: "Check the week strip", detail: "Scroll to \"This Week's Events\" for a quick read on what's happening in the next seven days, including manifest pick-readiness for each one." },
      { title: "Clear the alert banners first", detail: "Unpaid milestones and stuck-cleaning items surface at the top for a reason — deal with those before diving into anything else." },
      { title: "Use the calendar to spot conflicts", detail: "A day with a heavy tint has multiple things happening — worth a second look before confirming anything new for that date." },
    ],
    crossRefs: ["08", "13"],
    screenshot: "dashboard.png",
    screenshotCaption: "Home dashboard — this week's events, cash position, and the manifest pipeline.",
  },
  {
    number: "05",
    title: "Leads",
    tags: ["sales", "crm"],
    roles: ["Admin / Owner", "Sales"],
    summary:
      "Leads are pre-contact inquiries — someone interested, but not yet a Contact or a Project. Zeno captures them from multiple channels into one shared pipeline before they ever touch your accounting.",
    keyConcepts: [
      "Capture channels are modules an admin toggles on per org: a public web form, a QR code (for expos or venue signage), Instagram/Facebook link-outs, WhatsApp click-to-chat, manual entry, and a referral-code flow for existing clients.",
      "Every channel feeds the same pipeline: New → Contacted → Quote Sent → Won → Lost. Leads auto-assign round-robin to sales staff, and a stale lead (still \"New\" after 2 hours) flags itself with an SLA warning.",
      "Converting a lead (marking it Won) creates the Contact and the Project in one step — that's the handoff point into everything else in this guide.",
      "A referral program lives here too: an existing client's own referral code attributes new leads back to them, with reward tracking through to payout.",
    ],
    steps: [
      { title: "Enable the channels you'll use", detail: "Settings → Leads — toggle on Website, QR, Instagram, Facebook, or WhatsApp. Manual entry and referrals are always available." },
      { title: "Work the board", detail: "New leads land on the Kanban board. Assign, contact, and move each one through the stages as it progresses." },
      { title: "Convert when it's real", detail: "Hit \"Convert to Project\" once a lead is a genuine booking — this creates the Contact and Project together, pre-filled from what the lead already captured." },
    ],
    crossRefs: ["08"],
    screenshot: "leads.png",
    screenshotCaption: "The leads board — every channel feeding one shared pipeline.",
  },
  {
    number: "06",
    title: "Deals Pipeline",
    tags: ["sales", "crm"],
    roles: ["Admin / Owner", "Sales"],
    summary:
      "A general-purpose CRM pipeline for contacts, separate from the events-specific Leads and Projects system. Useful for tracking sales conversations that don't map cleanly onto an event booking.",
    note: "This is deliberately not merged with Leads or Projects — it's a different tool for a different kind of tracking, kept simple on purpose.",
  },
  {
    number: "07",
    title: "Customers & Vendors",
    subtitle: "Contacts",
    tags: ["sales", "spending", "core-data"],
    roles: ["Admin / Owner", "Accountant", "Sales", "HR", "Inventory"],
    summary:
      "One shared address book for everyone your business deals with — clients you invoice, vendors you buy from, or both. Every quote, invoice, bill, and project links back to a Contact here.",
    keyConcepts: [
      "A Contact's \"kind\" — customer, vendor, or both — decides which documents it can appear on.",
      "Customer groups can be turned on org-wide to organize clients and, when enabled, are required when creating a new customer.",
      "Vendors can have a saved default payout destination (M-Pesa, till, paybill) so bills don't require re-entering payment details every time.",
    ],
    crossRefs: ["08", "09", "10"],
  },
  {
    number: "08",
    title: "Projects",
    subtitle: "The hub everything else connects to",
    tags: ["operations", "core-data"],
    roles: ["Admin / Owner", "Accountant", "Sales", "Inventory", "General Staff"],
    summary:
      "A Project is one event — a wedding, a corporate function, a graduation. It's the single place that ties together the client, the money, the gear, the paperwork, and the timeline for that event.",
    keyConcepts: [
      "Lifecycle: Lead → Quoted → Confirmed → In Progress → Completed (or Cancelled at any point). Most of these transitions happen automatically as you work — see \"The Big Picture\" for exactly which actions trigger which move.",
      "The project page is organized into tabs: Overview, Quotes, Invoices, Expenses, Reservations, Payment Schedule, Damage Reports, Contracts, Files, Notes, Tasks, Milestones, and Audit Log — everything about this one event, in one place.",
      "Overview shows a lifecycle stepper, a budget-vs-invoiced-vs-collected comparison, a payment-milestone timeline, manifest pick-readiness, a cost breakdown, and a damage-report flag if one exists — the whole health of the event at a glance.",
      "A Payment Schedule can split the total into milestones (e.g. 50% deposit, 30% before the event, 20% on completion) — each milestone generates its own real invoice when it comes due, automatically pulling in any billable expenses tagged to the project that haven't been invoiced yet.",
      "Quotes and invoices created from within a project auto-pick that project's client — no need to search for the contact again.",
    ],
    steps: [
      { title: "Create the project", detail: "Either directly, or by converting a Lead — either way you land on the Overview tab." },
      { title: "Quote it", detail: "Quotes tab → New Quote. The client is pre-filled from the project." },
      { title: "Confirm it", detail: "Send the quote, get it accepted (or converted straight to invoice) — the project auto-advances to Confirmed, and any matching Event Inventory items get auto-reserved." },
      { title: "Run the event", detail: "The manifest (built from the reservations) drives what actually gets picked, loaded, and dispatched — see \"Manifests & Damage Reports\"." },
      { title: "Close it out", detail: "Once every invoice is paid in full and the manifest is reconciled, the project auto-completes." },
    ],
    crossRefs: ["02", "05", "09", "10", "11", "13", "14"],
    screenshot: "projects-overview.png",
    screenshotCaption: "Project Overview tab — lifecycle stepper, financial bars, payment timeline, manifest readiness.",
  },
  {
    number: "09",
    title: "Quotes & Quote Templates",
    tags: ["sales", "money"],
    roles: ["Admin / Owner", "Accountant", "Sales"],
    summary:
      "A quote is a formal, priced proposal for a client. It can be issued as a draft, sent for review, accepted, declined, or converted straight into an invoice.",
    keyConcepts: [
      "Line items can be real catalog items, custom one-off lines, or category headings — a heading is a bold divider with no price, useful for grouping a quote into sections (e.g. \"Décor\", \"Catering\").",
      "Sending a quote (draft → sent) is what first moves its project from Lead to Quoted.",
      "Accepting a quote, or converting it straight to invoice — even without an explicit \"Accept\" — moves the project on to Confirmed.",
      "Converting preserves everything, including category headings, onto the resulting invoice.",
      "Quote Templates save a reusable starting point (line items, notes, terms) so a common package doesn't have to be rebuilt from scratch every time.",
    ],
    crossRefs: ["08", "10"],
    screenshot: "quotes-list.png",
    screenshotCaption: "The Quotes list — every quote, its status, and its total.",
  },
  {
    number: "10",
    title: "Invoices, Payments Received & Credit Notes",
    tags: ["sales", "money"],
    roles: ["Admin / Owner", "Accountant", "Sales"],
    summary:
      "Invoices are the billing document clients actually pay. Recording a payment against one updates its balance in real time; a credit note reverses part or all of one without deleting the record.",
    keyConcepts: [
      "Issuing an invoice signs it (where eTIMS is enabled) and posts it to the ledger — it's a real accounting event from that point, not just a draft.",
      "An issued-but-unpaid, still-open invoice can be edited under a permission gate; anything with a payment already applied, or a reconciled bank entry, has to be voided and reissued instead.",
      "A fully paid invoice is one half of what auto-completes a project — the other half is a reconciled manifest (see \"The Big Picture\").",
      "Payments Received lists every payment against every invoice; Credit Notes handles partial or full reversals, either freehand or copied wholesale from an existing invoice.",
    ],
    crossRefs: ["02", "08", "16"],
    screenshot: "invoices-list.png",
    screenshotCaption: "The Invoices list — status, balance due, and payment state at a glance.",
  },
  {
    number: "11",
    title: "Event Inventory & Reservations",
    subtitle: "Rental gear — chairs, tents, décor",
    tags: ["inventory", "operations"],
    roles: ["Admin / Owner", "Accountant", "Sales", "Inventory"],
    summary:
      "Event Inventory tracks rentable gear that cycles out to an event and back, rather than being sold and consumed — a fundamentally different lifecycle from ordinary stock.",
    keyConcepts: [
      "Each catalog item can have one or more physical batches (a labeled set or serialized unit) sitting in a specific warehouse, with its own status: in store, reserved, dispatched, at event, returned, damaged, or on external hire.",
      "A Reservation ties one batch to one project across a date range. Reservations made before a project is confirmed are provisional (\"quoted\") and don't lock the item; confirming the project promotes them to firm bookings automatically.",
      "Reservations are also auto-created from invoice content: once a project is confirmed, any invoice line item that maps to exactly one unambiguous batch, with enough free quantity and no date conflict, gets reserved automatically. Anything ambiguous is left for a human to sort out — it never silently guesses.",
      "This auto-booking re-runs on every invoice save, issue, or edit for an already-confirmed project — not just the one moment it first confirms — so adding more items later still gets picked up.",
      "A conflict check blocks double-booking the same batch across overlapping dates, with a clear override available for an admin who genuinely needs to book anyway.",
    ],
    note: "Event Inventory items can be created inline, right from this screen, without a detour through Items & Stock first — useful the first time a brand-new piece of rental gear enters the catalog.",
    crossRefs: ["08", "12", "13"],
    screenshot: "event-inventory.png",
    screenshotCaption: "Event Inventory list — batches, warehouse locations, and live reservation status.",
  },
  {
    number: "12",
    title: "Items & Stock, Warehouses, Stock Transfers",
    tags: ["inventory", "spending"],
    roles: ["Admin / Owner", "Accountant", "Sales", "Inventory", "Warehouse Staff"],
    summary:
      "The general catalog and stock ledger — every item your business sells or buys, whether it's tracked stock, a service, or rental gear (which also has an Event Inventory presence).",
    keyConcepts: [
      "Tracked stock uses FIFO costing — each purchase creates a lot at its own cost, and a sale consumes the oldest lot first, keeping cost-of-goods-sold accurate automatically.",
      "Warehouses are physical locations; Stock Transfers move quantity between them without touching valuation.",
      "An item can carry a reorder level — falling below it is what powers the low-stock alert on the dashboard.",
      "Items and Event Inventory share the same underlying catalog row — an item with rental batches shows a small badge linking straight across to its Event Inventory presence.",
    ],
    crossRefs: ["11"],
    screenshot: "items-stock.png",
    screenshotCaption: "Items & Stock — the general catalog, stock levels, and reorder points.",
  },
  {
    number: "13",
    title: "Manifests & Damage Reports",
    subtitle: "\"My Tasks\" for operational staff",
    tags: ["operations", "logistics"],
    roles: ["Admin / Owner", "Accountant", "Inventory", "Loading Staff", "Warehouse Staff", "Collection Staff"],
    summary:
      "A manifest is the real-world dispatch checklist for one confirmed project's reservations — what has to be picked, loaded, sent out, and eventually returned and inspected.",
    keyConcepts: [
      "A manifest line moves through a fixed sequence: pending → picked → loaded → dispatched → at event → collected → returned → inspected (with an inspected outcome of good, needs cleaning, or damaged).",
      "Operational roles (Loading, Warehouse, Collection staff) see only this screen and almost nothing else — a deliberately narrow, mobile-friendly checklist rather than the full admin view.",
      "Reconciling a manifest is the explicit, final step that confirms every durable item is accounted for. It's also one half of what auto-completes the project.",
      "Flagging an item as damaged during inspection creates a Damage Report — tracked separately with its own liability status (pending, absorbed by the business, or billed to the client) and photo evidence.",
    ],
    steps: [
      { title: "Pick", detail: "Warehouse staff mark each durable line as picked once it's physically pulled." },
      { title: "Load & dispatch", detail: "Loading staff move lines through loaded → dispatched as the gear leaves for the venue." },
      { title: "Collect & return", detail: "Collection staff bring items back and mark them returned." },
      { title: "Inspect", detail: "Each returned item is inspected — good, needs cleaning, or damaged. Damaged items automatically open a Damage Report." },
      { title: "Reconcile", detail: "Once every durable line has an inspected outcome, an admin reconciles the manifest — this is the point of no return for that job." },
    ],
    crossRefs: ["08", "11"],
    screenshot: "manifest.png",
    screenshotCaption: "Manifest checklist — one line per durable item, with its current pick/load/dispatch status.",
  },
  {
    number: "14",
    title: "Contracts",
    subtitle: "Types, templates, and dual-party signing",
    tags: ["sales", "legal"],
    roles: ["Admin / Owner", "Accountant", "Sales", "Inventory", "General Staff"],
    summary:
      "Client service agreements, tied to a project, with admin-managed types and reusable templates — and a full two-signature legal flow rather than a single click marking things \"done\".",
    keyConcepts: [
      "Contract Types are an admin-managed list (Settings → Contracts) — the same pattern as custom staff roles: a small, org-defined vocabulary, not a hardcoded picklist.",
      "Contract Templates belong to a type and hold two independent bodies of text: Content (the main agreement) and Payment Terms — both support merge fields like {{client_name}}, {{event_date}}, {{venue}}, and {{budget}}, inserted via click-to-add chips rather than hand-typed syntax.",
      "Starting a new contract on a project can pick a template, which auto-fills both fields with the merge fields already resolved — still fully editable before saving.",
      "A contract is only fully executed once both parties have signed: the client, and a staff member countersigning on behalf of the company. Either side can sign first.",
      "Signing is a real drawn signature — a finger/mouse signature pad, not a typed name rendered in cursive font — captured for both the client (in the client portal) and the staff countersignature.",
      "A wet-ink alternative still exists: uploading a photo of a physically signed, printed copy marks the contract fully executed in one step, since that single page is presumed to carry both signatures already.",
    ],
    note: "A contract's PDF renders both signature blocks side by side — client and company — each showing the real drawn mark, the signer's name, and the exact date and time signed.",
    crossRefs: ["08", "21"],
    screenshot: "contracts.png",
    screenshotCaption: "A project's Contracts tab — status, type, and both signatures once fully executed.",
  },
  {
    number: "15",
    title: "Expenses, Expense Claims, Bills & Purchase Orders",
    tags: ["spending"],
    roles: ["Admin / Owner", "Accountant", "Inventory"],
    summary:
      "Everything money going out of the business, from a same-day cash purchase to a formal vendor bill on credit terms.",
    keyConcepts: [
      "An Expense is paid immediately from a bank/cash account. A Bill is a vendor invoice you owe, paid later. A Purchase Order commits to buying before a bill even exists.",
      "An expense (or bill) can be tagged \"billable\" to a project's client — it then automatically folds into that project's next milestone invoice as a real line item, not just a note.",
      "Expense Claims are the staff-facing side: any employee can submit a reimbursement claim regardless of role — everyone in the org has this permission by default.",
      "Above a configurable amount, spend can require admin/accountant approval before it posts — with an SMS notification for fast sign-off from a phone.",
    ],
    crossRefs: ["08"],
  },
  {
    number: "16",
    title: "Bank & M-Pesa, Accountant, Fixed Assets",
    tags: ["money"],
    roles: ["Admin / Owner", "Accountant"],
    summary:
      "The accounting backbone: bank reconciliation, the general ledger, and fixed-asset tracking with depreciation.",
    keyConcepts: [
      "Bank transactions can be imported or synced and categorized against the chart of accounts; a matched line reconciles against its originating invoice, bill, or payment.",
      "The Accountant area exposes the raw double-entry ledger and journal entries underneath every document in the system, for anyone who needs to go that deep.",
      "Fixed Assets tracks equipment the business owns outright (not rental inventory) with its own depreciation schedule.",
    ],
  },
  {
    number: "17",
    title: "Analytics & Reports",
    tags: ["money", "insights"],
    roles: ["Admin / Owner", "Accountant", "HR"],
    summary:
      "Reports cover the standard accounting set — trial balance, P&L, VAT prep. Analytics adds an events-specific layer: margin by event type, seasonal booking curves, budget-vs-actual, and a full booking-to-billing funnel.",
    keyConcepts: [
      "Reports are the compliance layer — what you'd hand to an accountant or file with iTax.",
      "Analytics is the decision-making layer — which event types are actually profitable, when the busy season really is, whether damage rates or repeat-client rates are trending in the right direction.",
    ],
    screenshot: "analytics.png",
    screenshotCaption: "Analytics — margin by event type, seasonal trends, and the booking-to-billing funnel.",
  },
  {
    number: "18",
    title: "Payroll",
    tags: ["hr", "money"],
    roles: ["Admin / Owner", "HR"],
    summary: "Staff payroll runs, statutory rules and tax, and staff loans/deductions — a self-contained module for organizations that pay employees through Zeno directly.",
  },
  {
    number: "19",
    title: "Staff & Roles",
    subtitle: "Who can see what",
    tags: ["admin"],
    roles: ["Admin / Owner"],
    summary:
      "Where an admin creates staff accounts, assigns roles, and — critically — controls exactly which modules each role can see, including any custom roles created for this org.",
    keyConcepts: [
      "Creating a custom role is a single typed name — it then appears everywhere a role picker does, with zero default permissions until an admin grants some.",
      "The permission matrix on this page is the literal source of truth for every sidebar item everyone in the org sees. Section 03 (\"Roles & What Each One Sees\") documents the defaults; this is where they're changed.",
    ],
    crossRefs: ["03"],
    screenshot: "staff-roles.png",
    screenshotCaption: "Staff & Roles — staff accounts and the per-role permission matrix.",
  },
  {
    number: "20",
    title: "Settings",
    tags: ["admin"],
    roles: ["Admin / Owner"],
    summary:
      "Org-wide configuration: company profile and branding, billing, payment gateways, SMS receipts, the customer OTP portal, lead capture channels, and contract types & templates.",
    keyConcepts: [
      "Org Profile carries the details that appear on every document: name, logo, brand color, KRA PIN, invoice/quote numbering, footer text, and payment/terms boilerplate.",
      "Billing shows the org's own subscription status and lets an admin pay via the same M-Pesa/card flow clients use.",
      "Payment Gateways connects M-Pesa Daraja or Kopo Kopo for automated, matched inbound payments — no manual reconciliation needed for gateway traffic.",
      "The Customer Portal (OTP) setting is a separate, simpler client-facing surface from the full Client Portal — a QR code customers scan to look up receipts by phone verification alone, no account required.",
      "Contract Types & Templates is where the admin-managed contract vocabulary from Section 14 actually lives.",
    ],
    crossRefs: ["14", "19"],
    screenshot: "settings.png",
    screenshotCaption: "Settings — org profile, billing, gateways, and every other org-wide configuration screen.",
  },
  {
    number: "21",
    title: "The Client Portal",
    subtitle: "What your clients actually see",
    tags: ["client-facing"],
    roles: ["Clients (not staff)"],
    summary:
      "A completely separate, client-facing application — its own login (email + password), its own navigation, and a hard boundary around what internal data it can ever show.",
    keyConcepts: [
      "Clients see only their own projects, documents, and contracts — never cost breakdowns, margins, staff notes, other clients' data, or anything from the internal warehouse/manifest system.",
      "From their dashboard, a client can view their event's live status (a client-safe version of the same lifecycle stepper staff see), review and pay invoices, and review and accept quotes.",
      "Accepting a quote in the portal does exactly what accepting it does on the staff side — the project auto-advances to Confirmed, visible to staff immediately since it's the same underlying record.",
      "Signing a contract is a real two-step flow: the client agrees to the terms, then draws an actual signature on a signature pad — not a single \"I agree\" click. The contract only becomes fully legal once the company's own staff countersignature is also on file.",
    ],
    note: "This is a genuinely separate app from the one described in the rest of this guide. If a client ever asks you something about \"the system\", double-check whether they mean their portal or your staff app — the two look and behave differently on purpose.",
    crossRefs: ["08", "09", "10", "14"],
    screenshot: "client-portal-project.png",
    screenshotCaption: "Client Portal project view — lifecycle progress, documents, and contracts, from the client's side.",
  },
  {
    number: "22",
    title: "End-to-End Walkthroughs",
    tags: ["orientation", "workflows"],
    roles: ["Everyone"],
    summary: "Three complete stories, start to finish, tying every section above into one continuous flow.",
    keyConcepts: [
      "Booking a wedding, start to finish: a lead comes in from the website → Sales converts it to a Project → drafts and sends a Quote → client accepts it in the portal, Project auto-confirms → Event Inventory items on the invoice auto-reserve → a manifest builds from those reservations → warehouse staff pick, load, and dispatch on event day → collection staff bring everything back and it's inspected → the final milestone invoice is paid in full → manifest reconciles → Project auto-completes.",
      "Handling a damaged item: an item comes back from an event and gets inspected as damaged → a Damage Report opens automatically with photo evidence → an admin sets its liability status (absorbed, or billed to the client) → if billed, it flows onto the client's next invoice as a real charge, not a side conversation.",
      "Getting a contract signed by both parties: admin drafts a contract from a template, content and payment terms pre-filled → marks it sent → client reviews it in the portal, agrees, and draws their signature → staff sees it's client-signed and countersigns on behalf of the company from the project's Contracts tab, drawing their own signature → contract flips to fully executed, both signatures visible on the PDF, both parties can download it.",
    ],
    crossRefs: ["02", "08", "11", "13", "14", "21"],
  },
  {
    number: "23",
    title: "Glossary & Tag Index",
    tags: ["reference"],
    roles: ["Everyone"],
    summary: "Quick definitions for terms used throughout this guide, and which sections each tag touches.",
    keyConcepts: [
      "Project — one event, the hub every other record connects to.",
      "Lead — a pre-contact inquiry, not yet a Contact or Project.",
      "Reservation — one batch of Event Inventory held for one project across a date range; \"quoted\" (provisional) until the project confirms, then \"booked\" (firm).",
      "Manifest — the dispatch checklist built from a confirmed project's reservations.",
      "Batch — a physical, labeled group (or serialized unit) of one catalog item, living in one warehouse.",
      "Countersignature — the company/staff side of a contract's two required signatures, independent of the client's.",
      "Auto-advance / auto-book / auto-complete — the automatic, forward-only status transitions this guide describes throughout Section 02; none of them can move a project backward, and none of them fire on a project that's cancelled.",
    ],
  },
  {
    number: "24",
    title: "Getting Help",
    tags: ["orientation"],
    roles: ["Everyone"],
    summary:
      "This guide lives in the app itself under Documentation in the sidebar, so it's always available even without this PDF on hand. If something in the live system doesn't match what's written here, the in-app version is the current one — this PDF is a snapshot.",
  },
];
