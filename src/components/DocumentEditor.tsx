"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { computeDocument, TAX_CLASSES, type TaxClass } from "@/lib/tax";
import { fmtKES, parseKES, todayISO } from "@/lib/money";
import { upsertDocumentAction, createItemFromLine, listCustomerInvoices, saveContact, type DocLineInput } from "@/lib/actions";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DimensionQtyInput } from "@/components/DimensionQtyInput";

type Option = { id: number; label: string };
type ItemOption = {
  id: number;
  name: string;
  salePriceCents: number;
  purchaseCostCents: number;
  taxClass: string;
  unit: string;
  trackInventory: boolean;
  measurementType?: string | null;
  /** Default bill/expense/PO category — auto-fills the line's category
   *  when this item is picked, so it isn't left blank (and blocking save)
   *  for something the item itself already knows the answer to. */
  purchaseAccountId?: number | null;
};

interface EditorLine {
  itemId: number | null;
  description: string;
  qty: string;
  price: string; // user-facing KES string
  discountPct: string;
  taxClass: TaxClass;
  accountId: number | null;
  customColumnValue: string;
  costCenterId: number | null;
  warehouseId: number | null;
  addToItems: boolean;
  newItemGroupId: number | null;
  /** Section heading row — groups the items listed under it. Contributes
   *  nothing to totals (qty/price stay 0), never has an item/account. */
  isHeading?: boolean;
}

const emptyLine = (): EditorLine => ({
  itemId: null,
  description: "",
  qty: "1",
  price: "",
  discountPct: "0",
  taxClass: "B16",
  accountId: null,
  customColumnValue: "",
  costCenterId: null,
  warehouseId: null,
  addToItems: false,
  newItemGroupId: null,
});

const emptyHeading = (): EditorLine => ({
  ...emptyLine(),
  qty: "0",
  isHeading: true,
});

export interface EditorInitialData {
  id?: number;
  contactId: number | "";
  date: string;
  dueDate: string;
  taxInclusive: boolean;
  notes: string;
  billNumber: string;
  payoutDestinationType?: "phone" | "till" | "paybill";
  payoutDestination?: string;
  payoutAccountNumber?: string;
  paidFrom: number | "";
  assignedMemberIds: number[];
  customerContactId?: number | "";
  relatedInvoiceId?: number | "";
  isBillable?: boolean;
  projectId?: number | "";
  isTemplate?: boolean;
  status?: string;
  lines: EditorLine[];
}

export function DocumentEditor({
  type,
  contacts,
  customers,
  items,
  itemGroups = [],
  itemGroupsRequired = false,
  expenseAccounts,
  bankAccounts,
  costCenters = [],
  warehouses = [],
  vendorPayouts,
  backHref,
  detailHref,
  defaultContactId,
  customDocumentColumnName,
  members,
  initialData,
  sourceInvoiceId,
  defaultNotes,
  projects = [],
  defaultProjectId,
  customerGroups = [],
  customerGroupsRequired = false,
}: {
  type: "invoice" | "quote" | "credit_note" | "bill" | "expense" | "purchase_order";
  contacts: Option[];
  /** Customers available for cost attribution on expenses/bills. Falls back to
   *  `contacts`, which is correct for sales documents but is the vendor list on
   *  purchases. */
  customers?: Option[];
  items: ItemOption[];
  itemGroups?: Option[];
  itemGroupsRequired?: boolean;
  expenseAccounts?: Option[];
  bankAccounts?: Option[];
  costCenters?: Option[];
  warehouses?: Option[];
  backHref: string;
  /** e.g. "/sales/invoices" — new doc id is appended */
  detailHref?: string;
  /** Purchase side only: vendor id -> saved default payout details, keyed
   *  from editorOptions("purchase"). Autofills the bill/PO destination
   *  fields when a vendor with saved details is picked. */
  vendorPayouts?: Record<number, { type: string | null; destination: string | null; accountNumber: string | null }>;
  /** preselect a customer/vendor (e.g. from the contact workspace) */
  defaultContactId?: number | null;
  /** Custom document column name, if any */
  customDocumentColumnName?: string | null;
  members?: Option[];
  initialData?: EditorInitialData;
  /** Credit notes only — tags lineage back to a specific invoice without
   *  copying its lines (unlike the "Full credit note" button, which copies
   *  everything at full amount via createCreditNoteFromInvoice). Lets staff
   *  build a partial-amount credit note freehand while still linking it to
   *  the invoice it's against. Only applied when creating a new document. */
  sourceInvoiceId?: number;
  defaultNotes?: string;
  /** Which project this document belongs to — shows up both in the main
   *  quotes/invoices/expenses lists and inside that project's own tabs. */
  projects?: Option[];
  defaultProjectId?: number | null;
  /** Sale-side only — powers the inline "+ New customer" picker. Mirrors
   *  the group requirement _saveContact() enforces server-side. */
  customerGroups?: Option[];
  customerGroupsRequired?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [contactOptions, setContactOptions] = useState<Option[]>(contacts);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerGroupId, setNewCustomerGroupId] = useState<number | "">("");
  const [newCustomerPending, setNewCustomerPending] = useState(false);
  const [newCustomerError, setNewCustomerError] = useState<string | null>(null);

  const isSale = type === "invoice" || type === "quote" || type === "credit_note";
  const isExpense = type === "expense";
  // Bills/POs are paid later, via gateway, straight to this destination —
  // mandatory. Expenses are paid immediately from the "Paid from" account
  // selected below; the destination here is just for the record (matching a
  // vendor's saved payout details) and to autofill it on any bill/PO raised
  // for the same vendor later, so it stays optional.
  const isSpendGatewayRequired = type === "bill" || type === "purchase_order";
  const [contactId, setContactId] = useState<number | "">(
    initialData?.contactId ?? (defaultContactId && contacts.some((c) => c.id === defaultContactId) ? defaultContactId : "")
  );
  const [date, setDate] = useState(initialData?.date ?? todayISO());
  const [dueDate, setDueDate] = useState(initialData?.dueDate ?? "");
  const [taxInclusive, setTaxInclusive] = useState(initialData?.taxInclusive ?? false);
  const [notes, setNotes] = useState(initialData?.notes ?? defaultNotes ?? "");
  const [billNumber, setBillNumber] = useState(initialData?.billNumber ?? "");
  const [payoutDestinationType, setPayoutDestinationType] = useState<"phone" | "till" | "paybill">(initialData?.payoutDestinationType ?? "phone");
  const [payoutDestination, setPayoutDestination] = useState(initialData?.payoutDestination ?? "");
  const [payoutAccountNumber, setPayoutAccountNumber] = useState(initialData?.payoutAccountNumber ?? "");
  const [paidFrom, setPaidFrom] = useState<number | "">(initialData?.paidFrom ?? "");
  const [assignedMemberIds, setAssignedMemberIds] = useState<number[]>(initialData?.assignedMemberIds ?? []);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  // Cost attribution — which customer this spend was for, and the invoice it
  // was rebilled on. Money-out documents only.
  const isSpend = type === "expense" || type === "bill";
  const [isBillable, setIsBillable] = useState<boolean>(initialData?.isBillable ?? false);
  const [projectId, setProjectId] = useState<number | "">(initialData?.projectId ?? defaultProjectId ?? "");
  const [customerContactId, setCustomerContactId] = useState<number | "">(initialData?.customerContactId ?? "");
  const [relatedInvoiceId, setRelatedInvoiceId] = useState<number | "">(initialData?.relatedInvoiceId ?? "");
  const [customerInvoices, setCustomerInvoices] = useState<{ id: number; number: string; date: string; totalCents: number; status: string }[]>([]);
  const [lines, setLines] = useState<EditorLine[]>(initialData?.lines ?? [emptyLine()]);

  // Reload the invoice list whenever the tagged customer changes. Any invoice
  // already selected belongs to the previous customer, so it's cleared unless
  // it survives in the new list.
  useEffect(() => {
    if (!isSpend || !customerContactId) {
      setCustomerInvoices([]);
      setRelatedInvoiceId("");
      return;
    }
    let cancelled = false;
    listCustomerInvoices(Number(customerContactId))
      .then((rows) => {
        if (cancelled) return;
        setCustomerInvoices(rows);
        setRelatedInvoiceId((cur) => (cur && rows.some((r) => r.id === cur) ? cur : ""));
      })
      .catch(() => {
        if (!cancelled) setCustomerInvoices([]);
      });
    return () => { cancelled = true; };
  }, [customerContactId, isSpend]);

  const itemOptions = useMemo(() => items.map((it) => ({ id: it.id, label: it.name })), [items]);

  const parsedLines: DocLineInput[] = useMemo(
    () =>
      lines
        .filter((l) => l.isHeading || l.description || l.itemId || parseKES(l.price) > 0)
        .map((l) => ({
          itemId: l.isHeading ? null : l.itemId,
          description: l.description || (l.isHeading ? "Section" : "Item"),
          qty: l.isHeading ? 0 : Number(l.qty) || 1,
          unitPriceCents: l.isHeading ? 0 : (Number.isNaN(parseKES(l.price)) ? 0 : parseKES(l.price)),
          discountPct: l.isHeading ? 0 : Number(l.discountPct) || 0,
          taxClass: l.taxClass,
          accountId: l.isHeading ? null : l.accountId,
          customColumnValue: l.customColumnValue || undefined,
          costCenterId: l.isHeading ? null : l.costCenterId,
          warehouseId: l.isHeading ? null : l.warehouseId,
          isHeading: l.isHeading ?? false,
        })),
    [lines]
  );

  const totals = useMemo(
    () =>
      computeDocument(
        parsedLines.map((l) => ({
          qty: l.qty,
          unitPriceCents: l.unitPriceCents,
          discountPct: l.discountPct,
          taxClass: l.taxClass,
        })),
        taxInclusive
      ),
    [parsedLines, taxInclusive]
  );

  function update(i: number, patch: Partial<EditorLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function moveLine(from: number, to: number) {
    if (from === to) return;
    setLines((ls) => {
      const next = [...ls];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function handleContactChange(id: number | "") {
    setContactId(id);
    // Only autofill an empty destination — never clobber something already
    // typed in (e.g. picking a vendor, then realizing you need a different
    // one-off destination for this particular bill).
    if ((type === "bill" || type === "purchase_order" || type === "expense") && id !== "" && !payoutDestination) {
      const saved = vendorPayouts?.[id];
      if (saved?.destination) {
        setPayoutDestinationType((saved.type as "phone" | "till" | "paybill") || "phone");
        setPayoutDestination(saved.destination);
        setPayoutAccountNumber(saved.accountNumber || "");
      }
    }
  }

  async function createNewCustomer() {
    setNewCustomerError(null);
    const displayName = newCustomerName.trim();
    if (!displayName) { setNewCustomerError("Name is required"); return; }
    if (customerGroupsRequired && newCustomerGroupId === "") { setNewCustomerError("Pick a customer group"); return; }
    setNewCustomerPending(true);
    try {
      const id = await saveContact({
        kind: "customer",
        displayName,
        phone: newCustomerPhone || undefined,
        email: newCustomerEmail || undefined,
        groupIds: newCustomerGroupId === "" ? [] : [Number(newCustomerGroupId)],
      });
      setContactOptions((prev) => [...prev, { id, label: displayName }]);
      handleContactChange(id);
      setShowNewCustomer(false);
      setNewCustomerName(""); setNewCustomerPhone(""); setNewCustomerEmail(""); setNewCustomerGroupId("");
    } catch (err) {
      setNewCustomerError(err instanceof Error ? err.message : "Could not create this customer");
    } finally {
      setNewCustomerPending(false);
    }
  }

  function pickItem(i: number, itemId: number) {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    const isSpendDoc = type === "bill" || type === "expense" || type === "purchase_order";
    update(i, {
      itemId,
      description: it.name,
      price: ((isSale ? it.salePriceCents : it.purchaseCostCents || it.salePriceCents) / 100).toFixed(2),
      taxClass: (it.taxClass as TaxClass) ?? "B16",
      // Auto-fill the category from the item's own saved default — without
      // this, picking an item on a bill/expense/PO auto-filled everything
      // EXCEPT category, which then blocked saving with "pick a category"
      // for something the item already had an answer for.
      ...(isSpendDoc && !it.trackInventory ? { accountId: it.purchaseAccountId ?? null } : {}),
    });
  }

  async function submit(issue: boolean) {
    setError(null);
    if (parsedLines.length === 0) return setError("Add at least one line.");
    if (!isExpense && !contactId) return setError(isSale ? "Choose a customer." : "Choose a vendor.");
    if (isExpense && !paidFrom) return setError("Choose the account you paid from.");
    startTransition(async () => {
      try {
        const finalLines: DocLineInput[] = [];
        for (const l of lines) {
          if (!(l.isHeading || l.description || l.itemId || parseKES(l.price) > 0)) continue;
          if (l.isHeading) {
            if (!l.description.trim()) throw new Error("Give every category heading a name");
            finalLines.push({
              itemId: null,
              description: l.description.trim(),
              qty: 0,
              unitPriceCents: 0,
              discountPct: 0,
              taxClass: l.taxClass,
              accountId: null,
              costCenterId: null,
              warehouseId: null,
              isHeading: true,
            });
            continue;
          }
          let itemId = l.itemId;
          const priceCents = Number.isNaN(parseKES(l.price)) ? 0 : parseKES(l.price);
          if (l.addToItems && !itemId && l.description.trim()) {
            if (itemGroupsRequired && !l.newItemGroupId) {
              throw new Error(`Pick an item group for "${l.description.trim()}"`);
            }
            itemId = await createItemFromLine({
              name: l.description.trim(),
              purchaseCostCents: priceCents,
              taxClass: l.taxClass,
              itemGroupId: l.newItemGroupId,
            });
          }
          const lineTrackedItem = itemId ? items.find((it) => it.id === itemId) : null;
          if ((type === "bill" || type === "expense" || type === "purchase_order") && !l.accountId && !lineTrackedItem?.trackInventory) {
            throw new Error(`Pick a category for "${l.description.trim() || "a line"}"`);
          }
          if ((type === "bill" || type === "expense" || type === "purchase_order") && costCenters.length > 0 && !l.costCenterId) {
            throw new Error(`Pick a cost center for "${l.description.trim() || "a line"}"`);
          }
          finalLines.push({
            itemId,
            description: l.description || "Item",
            qty: Number(l.qty) || 1,
            unitPriceCents: priceCents,
            discountPct: Number(l.discountPct) || 0,
            taxClass: l.taxClass,
            accountId: l.accountId,
            customColumnValue: l.customColumnValue || undefined,
            costCenterId: l.costCenterId,
            warehouseId: l.warehouseId,
          });
        }
        const isAlreadyIssued = !!(initialData?.id && initialData?.status && initialData.status !== "draft");
        const res = await upsertDocumentAction({
          id: initialData?.id,
          type,
          contactId: Number(contactId) || null,
          date,
          dueDate: dueDate || null,
          taxInclusive,
          notes: notes || undefined,
          billNumber: billNumber || undefined,
          payoutDestinationType: type === "bill" || type === "purchase_order" || type === "expense" ? payoutDestinationType : undefined,
          payoutDestination: type === "bill" || type === "purchase_order" || type === "expense" ? payoutDestination || undefined : undefined,
          payoutAccountNumber: (type === "bill" || type === "purchase_order" || type === "expense") && payoutDestinationType === "paybill" ? payoutAccountNumber || undefined : undefined,
          paidFromBankAccountId: paidFrom === "" ? null : paidFrom,
          customerContactId: isSpend && customerContactId !== "" ? Number(customerContactId) : null,
          relatedInvoiceId: isSpend && relatedInvoiceId !== "" ? Number(relatedInvoiceId) : null,
          isBillable: isSpend ? isBillable : false,
          projectId: projectId === "" ? null : Number(projectId),
          assignedMemberIds: assignedMemberIds.length > 0 ? assignedMemberIds : undefined,
          isTemplate: initialData?.isTemplate,
          saveAsTemplate,
          issue: issue && !isAlreadyIssued,
          sourceInvoiceId: type === "credit_note" && !initialData?.id ? sourceInvoiceId : undefined,
          lines: finalLines,
        });
        if (res.error || !res.id) throw new Error(res.error || "Could not save document");
        const id = res.id;
        router.push(detailHref ? `${detailHref}/${id}` : backHref);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  const inputCls =
    "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)]";
  const cellCls =
    "w-full rounded-md border border-transparent hover:border-[var(--color-ink-200)] focus:border-[var(--color-accent-500)] bg-transparent px-2 py-1.5 text-[13px] outline-none";

  // Item/desc, Qty, Price, Disc%, [custom col], VAT, [category], [cost center], [warehouse], Amount —
  // everything between the drag/# column and the remove column, spanned by a heading row.
  const middleColSpan =
    5 +
    (customDocumentColumnName ? 1 : 0) +
    (type === "bill" || type === "expense" || type === "purchase_order" ? 1 : 0) +
    (costCenters.length > 0 ? 1 : 0) +
    (warehouses.length > 0 ? 1 : 0);

  return (
    <div className="space-y-5">
      {/* Header fields */}
      <div className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {!isExpense && (
          <label className="block col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
                {isSale ? "Customer" : "Vendor"}
              </span>
              {isSale && (
                <button
                  type="button"
                  onClick={() => setShowNewCustomer((v) => !v)}
                  className="text-[11.5px] font-medium text-[var(--color-accent-600)] hover:underline"
                >
                  + New customer
                </button>
              )}
            </div>
            <SearchableSelect
              className="mt-1"
              options={isSale ? contactOptions : contacts}
              value={contactId}
              onChange={handleContactChange}
              placeholder={isSale ? "Search customers…" : "Search vendors…"}
            />
            {isSale && showNewCustomer && (
              <div className="mt-2 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 space-y-2 bg-[var(--color-ink-50)]/40">
                <input
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="Customer name"
                  className={inputCls}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="Phone"
                    className={inputCls}
                  />
                  <input
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    placeholder="Email"
                    className={inputCls}
                  />
                </div>
                {customerGroupsRequired && (
                  <select
                    value={newCustomerGroupId}
                    onChange={(e) => setNewCustomerGroupId(e.target.value ? Number(e.target.value) : "")}
                    className={inputCls}
                  >
                    <option value="">Select a customer group…</option>
                    {customerGroups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                )}
                {newCustomerError && <div className="text-[11.5px] text-[var(--color-bad)]">{newCustomerError}</div>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={newCustomerPending}
                    onClick={createNewCustomer}
                    className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[12.5px] font-medium px-3 py-1.5"
                  >
                    {newCustomerPending ? "Creating…" : "Create & select"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewCustomer(false)}
                    className="rounded-lg border border-[var(--color-ink-200)] text-[var(--color-ink-600)] text-[12.5px] font-medium px-3 py-1.5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </label>
        )}
        {isExpense && (
          <label className="block col-span-2">
            <span className="text-[12px] font-medium text-[var(--color-ink-600)]">Paid from</span>
            <select
              className={inputCls + " mt-1"}
              value={paidFrom}
              onChange={(e) => setPaidFrom(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Choose account…</option>
              {bankAccounts?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-[12px] font-medium text-[var(--color-ink-600)]">Date</span>
          <input type="date" className={inputCls + " mt-1"} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {(type === "invoice" || type === "bill") && (
          <label className="block">
            <span className="text-[12px] font-medium text-[var(--color-ink-600)]">Due date</span>
            <input type="date" className={inputCls + " mt-1"} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        )}
        {(type === "bill" || type === "expense") && (
          <label className="block">
            <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
              {type === "bill" ? "Vendor's invoice no." : "Reference"}
            </span>
            <input className={inputCls + " mt-1"} value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="optional" />
          </label>
        )}
        {(type === "bill" || type === "purchase_order" || type === "expense") && (
          <>
            <label className="block">
              <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
                Paid this vendor via{isSpendGatewayRequired ? <span className="text-[var(--color-bad)]"> *</span> : <span className="font-normal text-[var(--color-ink-400)]"> (optional — for the record)</span>}
              </span>
              <select
                className={inputCls + " mt-1"}
                value={payoutDestinationType}
                onChange={(e) => setPayoutDestinationType(e.target.value as "phone" | "till" | "paybill")}
              >
                <option value="phone">Mobile number (B2C)</option>
                <option value="till">Till number</option>
                <option value="paybill">Paybill</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
                {payoutDestinationType === "phone" ? "Vendor's M-Pesa number" : payoutDestinationType === "till" ? "Till number" : "Paybill number"}
                {isSpendGatewayRequired && <span className="text-[var(--color-bad)]"> *</span>}
              </span>
              <input
                className={inputCls + " mt-1"}
                value={payoutDestination}
                onChange={(e) => setPayoutDestination(e.target.value)}
                placeholder={payoutDestinationType === "phone" ? "2547…" : "e.g. 123456"}
                required={isSpendGatewayRequired}
              />
            </label>
            {payoutDestinationType === "paybill" && (
              <label className="block">
                <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
                  Account number{isSpendGatewayRequired && <span className="text-[var(--color-bad)]"> *</span>}
                </span>
                <input
                  className={inputCls + " mt-1"}
                  value={payoutAccountNumber}
                  onChange={(e) => setPayoutAccountNumber(e.target.value)}
                  placeholder="Account / reference number"
                  required={isSpendGatewayRequired}
                />
              </label>
            )}
          </>
        )}
        {projects.length > 0 && (
          <label className="block">
            <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
              Project <span className="font-normal text-[var(--color-ink-400)]">(optional)</span>
            </span>
            <select
              className={inputCls + " mt-1"}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 self-end pb-2">
          <input
            type="checkbox"
            checked={taxInclusive}
            onChange={(e) => setTaxInclusive(e.target.checked)}
            className="accent-[var(--color-accent-500)]"
          />
          <span className="text-[12.5px] text-[var(--color-ink-600)]">Prices include VAT</span>
        </label>
        {isSpend && (
          <div className="col-span-2 card p-3.5 bg-[var(--color-ink-50)] border border-[var(--color-ink-200)] rounded-xl space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isBillable}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsBillable(checked);
                  if (!checked) {
                    setCustomerContactId("");
                    setRelatedInvoiceId("");
                  }
                }}
                className="h-4 w-4 rounded accent-[var(--color-accent-600)]"
              />
              <div>
                <span className="text-[13px] font-semibold text-[var(--color-ink-800)] block">
                  Billable Expense
                </span>
                <span className="text-[11px] text-[var(--color-ink-500)] block">
                  Rebill this expense to a customer and combine it onto their invoice PDF.
                </span>
              </div>
            </label>

            {(isBillable || customerContactId !== "") && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 hairline-t">
                <label className="block">
                  <span className="text-[12px] font-medium text-[var(--color-ink-700)]">
                    Billable Customer <span className="text-[var(--color-ink-400)] font-normal">(required)</span>
                  </span>
                  <SearchableSelect
                    className="mt-1"
                    options={customers ?? contacts}
                    value={customerContactId}
                    onChange={setCustomerContactId}
                    placeholder="Search customer to bill…"
                  />
                </label>
                {customerContactId !== "" && (
                  <label className="block">
                    <span className="text-[12px] font-medium text-[var(--color-ink-700)]">
                      Combine with Invoice <span className="text-[var(--color-ink-400)] font-normal">(optional)</span>
                    </span>
                    <select
                      className={inputCls + " mt-1"}
                      value={relatedInvoiceId}
                      onChange={(e) => setRelatedInvoiceId(e.target.value ? Number(e.target.value) : "")}
                    >
                      <option value="">Link to invoice later</option>
                      {customerInvoices.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.number} · {inv.date} · {fmtKES(inv.totalCents)}
                        </option>
                      ))}
                    </select>
                    {customerInvoices.length === 0 && (
                      <span className="text-[10px] text-[var(--color-ink-400)] block mt-1">
                        No open invoices for this customer yet.
                      </span>
                    )}
                  </label>
                )}
              </div>
            )}
          </div>
        )}
        {members && members.length > 0 && (
          <label className="block col-span-2">
            <span className="text-[12px] font-medium text-[var(--color-ink-600)]">Assigned Staff</span>
            <select
              multiple
              className={inputCls + " mt-1 h-20"}
              value={assignedMemberIds.map(String)}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                setAssignedMemberIds(selected);
              }}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-[var(--color-ink-400)] block mt-1">Hold Cmd/Ctrl to select multiple</span>
          </label>
        )}
      </div>

      {/* Lines */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="hairline-b">
            <tr className="text-[11.5px] uppercase tracking-wide text-[var(--color-ink-400)]">
              <th className="text-left px-2 py-2.5 font-semibold w-[3%]">#</th>
              <th className="text-left px-4 py-2.5 font-semibold w-[34%]">Item / description</th>
              <th className="text-right px-2 py-2.5 font-semibold w-[8%]">Qty</th>
              <th className="text-right px-2 py-2.5 font-semibold w-[13%]">Price (KSh)</th>
              <th className="text-right px-2 py-2.5 font-semibold w-[9%]">Disc %</th>
              {customDocumentColumnName && (
                <th className="text-left px-2 py-2.5 font-semibold">{customDocumentColumnName}</th>
              )}
              <th className="text-left px-2 py-2.5 font-semibold w-[13%]">VAT</th>
              {(type === "bill" || type === "expense" || type === "purchase_order") && (
                <th className="text-left px-2 py-2.5 font-semibold w-[15%]">Category</th>
              )}
              {costCenters.length > 0 && (
                <th className="text-left px-2 py-2.5 font-semibold w-[13%]">Cost center</th>
              )}
              {warehouses.length > 0 && (
                <th className="text-left px-2 py-2.5 font-semibold w-[13%]">Warehouse</th>
              )}
              <th className="text-right px-4 py-2.5 font-semibold w-[13%]">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const t = totals.lines[parsedLines.findIndex((_, pi) => pi === i)] ?? null;
              if (l.isHeading) {
                return (
                  <tr
                    key={i}
                    className={`hairline-t align-top bg-[var(--color-ink-50)] ${dragOverIndex === i && dragIndex !== null && dragIndex !== i ? "bg-[var(--color-accent-50,#f0f5ff)]" : ""}`}
                    onDragOver={(e) => {
                      if (dragIndex === null) return;
                      e.preventDefault();
                      if (dragOverIndex !== i) setDragOverIndex(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null) moveLine(dragIndex, i);
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                  >
                    <td
                      className="px-2 py-2.5 text-[13px] tnum text-[var(--color-ink-400)] cursor-grab active:cursor-grabbing select-none"
                      draggable
                      onDragStart={(e) => {
                        setDragIndex(i);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      title="Drag to reorder"
                    >
                      <span className="text-[var(--color-ink-300)]">⠿</span>
                    </td>
                    <td className="px-3 py-2" colSpan={middleColSpan}>
                      <input
                        className={cellCls + " font-semibold uppercase tracking-wide text-[11.5px] text-[var(--color-ink-600)]"}
                        placeholder="Category heading, e.g. Signage materials"
                        value={l.description}
                        onChange={(e) => update(i, { description: e.target.value })}
                      />
                    </td>
                    <td className="pr-2 py-3">
                      <button
                        type="button"
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                        className="text-[var(--color-ink-200)] hover:text-[var(--color-bad)] text-[15px]"
                        aria-label="Remove heading"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr
                  key={i}
                  className={`hairline-t align-top ${dragOverIndex === i && dragIndex !== null && dragIndex !== i ? "bg-[var(--color-accent-50,#f0f5ff)]" : ""}`}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    if (dragOverIndex !== i) setDragOverIndex(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) moveLine(dragIndex, i);
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                >
                  <td
                    className="px-2 py-3.5 text-[13px] tnum text-[var(--color-ink-400)] cursor-grab active:cursor-grabbing select-none"
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    title="Drag to reorder"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-[var(--color-ink-300)]">⠿</span>
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {items.length > 0 && (
                      <SearchableSelect
                        className="mb-1"
                        inputClassName={cellCls + " border-[var(--color-ink-200)]"}
                        options={itemOptions}
                        value={l.itemId ?? ""}
                        onChange={(id) => (id === "" ? update(i, { itemId: null }) : pickItem(i, id))}
                        placeholder="Search items…"
                      />
                    )}
                    <input
                      className={cellCls}
                      placeholder="Description"
                      value={l.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                    />
                    {(type === "bill" || type === "purchase_order") && !l.itemId && l.description.trim() && (
                      <div className="mt-1 pl-2">
                        <label className="flex items-center gap-1 text-[11px] text-[var(--color-ink-500)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={l.addToItems}
                            onChange={(e) => update(i, { addToItems: e.target.checked })}
                            className="accent-[var(--color-accent-500)]"
                          />
                          Add &quot;{l.description.trim()}&quot; to Items list
                        </label>
                        {l.addToItems && (itemGroups.length > 0 || itemGroupsRequired) && (
                          <select
                            className={cellCls + " mt-1 max-w-[220px]"}
                            value={l.newItemGroupId ?? ""}
                            onChange={(e) => update(i, { newItemGroupId: e.target.value ? Number(e.target.value) : null })}
                          >
                            <option value="">{itemGroupsRequired ? "Select item group" : "No group"}</option>
                            {itemGroups.map((g) => (
                              <option key={g.id} value={g.id}>{g.label}</option>
                            ))}
                          </select>
                        )}
                        {l.addToItems && itemGroupsRequired && itemGroups.length === 0 && (
                          <div className="mt-1 text-[11px] text-[var(--color-bad)]">
                            Create an item group first before adding this line into Items.
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-2">
                    {(() => {
                      const pickedItem = l.itemId ? items.find((it) => it.id === l.itemId) : null;
                      if (pickedItem?.measurementType === "area") {
                        return (
                          <DimensionQtyInput
                            measurementType="area"
                            unit={pickedItem.unit}
                            value={l.qty}
                            onChange={(v) => update(i, { qty: v })}
                            compact
                          />
                        );
                      }
                      return (
                        <input
                          className={cellCls + " text-right"}
                          value={l.qty}
                          onChange={(e) => update(i, { qty: e.target.value })}
                        />
                      );
                    })()}
                  </td>
                  <td className="px-1 py-2">
                    <input
                      className={cellCls + " text-right"}
                      placeholder="0.00"
                      value={l.price}
                      onChange={(e) => update(i, { price: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-2">
                    <input
                      className={cellCls + " text-right"}
                      value={l.discountPct}
                      onChange={(e) => update(i, { discountPct: e.target.value })}
                    />
                  </td>
                  {customDocumentColumnName && (
                    <td className="px-1 py-2">
                      <input
                        className={cellCls}
                        value={l.customColumnValue}
                        onChange={(e) => update(i, { customColumnValue: e.target.value })}
                        placeholder={customDocumentColumnName}
                      />
                    </td>
                  )}
                  <td className="px-1 py-2">
                    <select
                      className={cellCls}
                      value={l.taxClass}
                      onChange={(e) => update(i, { taxClass: e.target.value as TaxClass })}
                    >
                      {Object.entries(TAX_CLASSES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {(type === "bill" || type === "expense" || type === "purchase_order") && (
                    <td className="px-1 py-2">
                      {(() => {
                        const trackedItem = l.itemId ? items.find((it) => it.id === l.itemId) : null;
                        if (trackedItem?.trackInventory && (type === "bill" || type === "purchase_order")) {
                          // Whatever category is picked here is silently
                          // overridden to Inventory Asset at posting time for
                          // tracked items (addLot() always runs, so the ledger
                          // must match it or quantity and value drift apart) —
                          // showing a live picker that gets ignored is exactly
                          // what caused "converting to a bill doesn't affect
                          // COGS" reports. Make the real behavior visible
                          // instead of silently discarding the selection.
                          return (
                            <div className="text-[11.5px] text-[var(--color-ink-500)] px-1 py-1.5" title="This item is inventory-tracked — its cost posts to Inventory Asset now and moves to Cost of Goods Sold automatically when it's sold (or via Items → Adjust Stock → Used in production).">
                              Inventory Asset
                            </div>
                          );
                        }
                        return (
                          <select
                            className={cellCls}
                            value={l.accountId ?? ""}
                            onChange={(e) =>
                              update(i, { accountId: e.target.value ? Number(e.target.value) : null })
                            }
                          >
                            <option value="">Select category…</option>
                            {expenseAccounts?.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.label}
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </td>
                  )}
                  {costCenters.length > 0 && (
                    <td className="px-1 py-2">
                      <select
                        className={cellCls}
                        value={l.costCenterId ?? ""}
                        onChange={(e) => update(i, { costCenterId: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">—</option>
                        {costCenters.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  {warehouses.length > 0 && (
                    <td className="px-1 py-2">
                      <select
                        className={cellCls}
                        value={l.warehouseId ?? ""}
                        onChange={(e) => update(i, { warehouseId: e.target.value ? Number(e.target.value) : null })}
                      >
                        <option value="">Default</option>
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>{w.label}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="px-4 py-3.5 text-right text-[13px] tnum">
                    {t ? fmtKES(t.grossCents) : "—"}
                  </td>
                  <td className="pr-2 py-3">
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      className="text-[var(--color-ink-200)] hover:text-[var(--color-bad)] text-[15px]"
                      aria-label="Remove line"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="hairline-t px-4 py-2.5 flex items-center gap-6">
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, emptyLine()])}
            className="text-[13px] font-medium text-[var(--color-accent-600)] hover:text-[var(--color-accent-700)]"
          >
            + Add custom line
          </button>
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, emptyHeading()])}
            className="text-[13px] font-medium text-[var(--color-ink-500)] hover:text-[var(--color-ink-800)]"
          >
            + Add category heading
          </button>
          {items.length > 0 && (
            <SearchableSelect
              className="w-56"
              inputClassName="w-full text-[13px] border border-[var(--color-ink-200)] rounded px-2 py-1.5 outline-none focus:border-[var(--color-accent-500)] bg-white"
              options={itemOptions}
              value=""
              placeholder="Add from inventory…"
              onChange={(id) => {
                if (id === "") return;
                const item = items.find(i => i.id === id);
                if (item) {
                  const priceCents = isSale ? item.salePriceCents : item.purchaseCostCents;
                  setLines((ls) => {
                    const newLs = [...ls];
                    // Replace the first empty line if it is completely empty
                    if (newLs.length === 1 && !newLs[0].description && !newLs[0].price && !newLs[0].itemId) {
                      newLs.pop();
                    }
                    return [...newLs, {
                      itemId: item.id,
                      description: item.name,
                      qty: "1",
                      price: (priceCents / 100).toString(),
                      discountPct: "0",
                      taxClass: item.taxClass as TaxClass,
                      accountId: null,
                      customColumnValue: "",
                      costCenterId: null,
                      warehouseId: null,
                      addToItems: false,
                      newItemGroupId: null,
                    }];
                  });
                }
              }}
            />
          )}
        </div>
      </div>

      {/* Totals + notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <label className="block">
          <span className="text-[12px] font-medium text-[var(--color-ink-600)]">Notes (shown on document)</span>
          <textarea
            className={inputCls + " mt-1 h-24 resize-none"}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Payment terms, delivery details…"
          />
        </label>
        <div className="card px-5 py-4 self-start">
          <Row label="Subtotal (before VAT)" v={fmtKES(totals.subtotalCents)} />
          <Row label="VAT" v={fmtKES(totals.taxCents)} />
          <div className="hairline-t mt-2 pt-2 flex justify-between text-[15px] font-semibold">
            <span>Total</span>
            <span className="tnum">{fmtKES(totals.totalCents)}</span>
          </div>
        </div>
      </div>

      {error && <div className="text-[13px] text-[var(--color-bad)]">{error}</div>}

      <div className="relative z-[75] flex items-center gap-3">
        <button
          onClick={() => submit(true)}
          disabled={pending}
          className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[13px] font-medium px-5 py-2.5 transition-colors"
        >
          {pending ? "Saving…" : (initialData?.status && initialData.status !== "draft" ? "Save changes" : issueLabel(type))}
        </button>
        {(!initialData?.status || initialData.status === "draft") && (
          <button
            onClick={() => submit(false)}
            disabled={pending}
            className="rounded-lg border border-[var(--color-ink-200)] bg-white hover:bg-[var(--color-ink-50)] text-[13px] font-medium px-5 py-2.5 transition-colors"
          >
            Save as draft
          </button>
        )}
        <a href={backHref} className="text-[13px] text-[var(--color-ink-400)] hover:text-[var(--color-ink-600)] ml-1">
          Cancel
        </a>
        {!initialData?.isTemplate && (
          <label className="flex items-center gap-2 ml-4 text-[13px] text-[var(--color-ink-500)] cursor-pointer">
            <input
              type="checkbox"
              checked={saveAsTemplate}
              onChange={(e) => setSaveAsTemplate(e.target.checked)}
              className="rounded border-[var(--color-ink-200)] text-[var(--color-accent-500)] focus:ring-[var(--color-accent-500)]"
            />
            Save as Template
          </label>
        )}
      </div>
    </div>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex justify-between py-1 text-[13px]">
      <span className="text-[var(--color-ink-600)]">{label}</span>
      <span className="tnum">{v}</span>
    </div>
  );
}

function issueLabel(type: string) {
  switch (type) {
    case "invoice":
      return "Save & issue invoice";
    case "quote":
      return "Save & send quote";
    case "credit_note":
      return "Save & issue credit note";
    case "bill":
      return "Save & record bill";
    case "expense":
      return "Save expense";
    case "purchase_order":
      return "Save & send PO";
    default:
      return "Save & issue";
  }
}
