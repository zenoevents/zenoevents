"use client";

import { useState, useTransition, useRef } from "react";

const ROLES = ["admin", "accountant", "sales", "hr", "inventory", "staff", "loading_staff", "warehouse_staff", "collection_staff"] as const;
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { saveOrgProfile } from "@/lib/actions";
import Image from "next/image";
import Link from "next/link";

interface OrgData {
  name: string;
  kraPin?: string | null;
  vatRegistered: boolean;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  invoicePrefix: string;
  invoiceTemplate?: string | null;
  quoteTemplate?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  customDocumentColumnName?: string | null;
  documentFooterText?: string | null;
  paymentInfoText?: string | null;
  termsText?: string | null;
  dataSegregation: boolean;
  requireBillApproval: boolean;
  accountantApprovalLimitCents?: number | null;
  approvalRequestPhone?: string | null;
  accountantNotifyPhone?: string | null;
  restrictIssuedInvoiceEdit: boolean;
  issuedInvoiceEditRoles?: string | null;
  expenseClaimPayoutLimitCents?: number | null;
  expenseClaimPayoutGatewayId?: string | null;
  billPayoutGatewayId?: string | null;
  timeTrackingEnabled: boolean;
  itemGroupsEnabled: boolean;
  customerGroupsEnabled: boolean;
  bomEnabled: boolean;
  blockInsufficientStock: boolean;
  nextInvoiceNo?: number | null;
  nextQuoteNo?: number | null;
  userId?: string | null;
}

/** Users type "example.com" as often as "https://example.com" — a bare
 *  domain isn't a valid link target on a PDF/tap-to-open context, so default
 *  the scheme to https rather than rejecting or silently mis-linking it. */
function normalizeWebsite(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function OrgProfileForm({ initial, gatewayOptions = [] }: { initial: OrgData; gatewayOptions?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState(initial.name || "");
  const [kraPin, setKraPin] = useState(initial.kraPin || "");
  const [phone, setPhone] = useState(initial.phone || "");
  const [email, setEmail] = useState(initial.email || "");
  const [website, setWebsite] = useState(initial.website || "");
  const [address, setAddress] = useState(initial.address || "");
  const [vatRegistered, setVatRegistered] = useState(initial.vatRegistered);
  const [invoicePrefix, setInvoicePrefix] = useState(initial.invoicePrefix || "INV-");
  const [nextInvoiceNo, setNextInvoiceNo] = useState(initial.nextInvoiceNo ?? 1);
  const [nextQuoteNo, setNextQuoteNo] = useState(initial.nextQuoteNo ?? 1);
  const [invoiceTemplate, setInvoiceTemplate] = useState(initial.invoiceTemplate || "default");
  const [quoteTemplate, setQuoteTemplate] = useState(initial.quoteTemplate || "default");
  const [brandColor, setBrandColor] = useState(initial.brandColor || "#0f766e");
  const [customDocumentColumnName, setCustomDocumentColumnName] = useState(initial.customDocumentColumnName || "");
  const [documentFooterText, setDocumentFooterText] = useState(initial.documentFooterText || "");
  const [paymentInfoText, setPaymentInfoText] = useState(initial.paymentInfoText || "");
  const [termsText, setTermsText] = useState(initial.termsText || "");
  const [dataSegregation, setDataSegregation] = useState(initial.dataSegregation);
  const [requireBillApproval, setRequireBillApproval] = useState(initial.requireBillApproval);
  const [accountantApprovalLimit, setAccountantApprovalLimit] = useState(
    initial.accountantApprovalLimitCents != null ? (initial.accountantApprovalLimitCents / 100).toFixed(2) : ""
  );
  const [approvalRequestPhone, setApprovalRequestPhone] = useState(initial.approvalRequestPhone || "");
  const [accountantNotifyPhone, setAccountantNotifyPhone] = useState(initial.accountantNotifyPhone || "");
  const [restrictIssuedInvoiceEdit, setRestrictIssuedInvoiceEdit] = useState(initial.restrictIssuedInvoiceEdit ?? false);
  const [issuedInvoiceEditRoles, setIssuedInvoiceEditRoles] = useState<string[]>(() => {
    try {
      return JSON.parse(initial.issuedInvoiceEditRoles || "[]");
    } catch {
      return [];
    }
  });
  const [expenseClaimPayoutLimit, setExpenseClaimPayoutLimit] = useState(
    initial.expenseClaimPayoutLimitCents ? (initial.expenseClaimPayoutLimitCents / 100).toFixed(2) : "0"
  );
  const [expenseClaimPayoutGatewayId, setExpenseClaimPayoutGatewayId] = useState(initial.expenseClaimPayoutGatewayId || "");
  const [billPayoutGatewayId, setBillPayoutGatewayId] = useState(initial.billPayoutGatewayId || "");
  const [timeTrackingEnabled, setTimeTrackingEnabled] = useState(initial.timeTrackingEnabled);
  const [itemGroupsEnabled, setItemGroupsEnabled] = useState(initial.itemGroupsEnabled);
  const [customerGroupsEnabled, setCustomerGroupsEnabled] = useState(initial.customerGroupsEnabled);
  const [bomEnabled, setBomEnabled] = useState(initial.bomEnabled);
  const [blockInsufficientStock, setBlockInsufficientStock] = useState(initial.blockInsufficientStock);

  const fileRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(initial.logoUrl || null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be under 2 MB.");
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setError(null);
  }

  async function uploadLogo(userId: string): Promise<string | null> {
    if (!logoFile) return null;
    setLogoUploading(true);
    try {
      const supabase = createClient();
      const ext = logoFile.name.split(".").pop();
      const path = `${userId}/logo.${ext}`;
      const { error } = await supabase.storage
        .from("logos")
        .upload(path, logoFile, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("logos").getPublicUrl(path);
      // Re-uploading to the same path (upsert) returns the exact same public
      // URL every time — Supabase Storage's CDN caches that URL, so browsers
      // keep serving the old cached image forever even though the file on
      // disk changed. This is the reported bug: "updating the logo doesn't
      // really update it." A cache-busting query param forces every client
      // (and the invoice PDF renderer, which reads this same URL) to refetch.
      return `${data.publicUrl}?v=${Date.now()}`;
    } finally {
      setLogoUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!name.trim()) {
      setError("Business name is required.");
      return;
    }
    startTransition(async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const newLogoUrl = logoFile ? await uploadLogo(user.id) : undefined;

        await saveOrgProfile({
          name: name.trim(),
          kraPin: kraPin || undefined,
          vatRegistered,
          address: address || undefined,
          phone: phone || undefined,
          email: email || undefined,
          website: normalizeWebsite(website) || undefined,
          invoicePrefix: invoicePrefix || "INV-",
          invoiceTemplate,
          quoteTemplate,
          logoUrl: newLogoUrl ?? undefined,
          brandColor,
          customDocumentColumnName: customDocumentColumnName,
          documentFooterText: documentFooterText,
          paymentInfoText: paymentInfoText,
          termsText: termsText,
          dataSegregation,
          requireBillApproval,
          accountantApprovalLimitCents: accountantApprovalLimit.trim() ? Math.round((Number(accountantApprovalLimit) || 0) * 100) : null,
          approvalRequestPhone: approvalRequestPhone || undefined,
          accountantNotifyPhone: accountantNotifyPhone || undefined,
          restrictIssuedInvoiceEdit,
          issuedInvoiceEditRoles: JSON.stringify(issuedInvoiceEditRoles),
          expenseClaimPayoutLimitCents: Math.round((Number(expenseClaimPayoutLimit) || 0) * 100),
          expenseClaimPayoutGatewayId: expenseClaimPayoutGatewayId || null,
          billPayoutGatewayId: billPayoutGatewayId || null,
          timeTrackingEnabled,
          itemGroupsEnabled,
          customerGroupsEnabled,
          bomEnabled,
          blockInsufficientStock,
          nextInvoiceNo: Number(nextInvoiceNo) || 1,
          nextQuoteNo: Number(nextQuoteNo) || 1,
        });
        setSaved(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  const inputCls =
    "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] transition-all mt-1";
  const labelCls = "text-[12px] font-medium text-[var(--color-ink-600)]";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      {/* Business identity */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)] mb-4">
          Business identity
        </div>
        <div className="flex items-start gap-4 mb-5">
          {/* Logo */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative shrink-0 w-[64px] h-[64px] rounded-xl border-2 border-dashed border-[var(--color-ink-200)] hover:border-[var(--color-accent-500)] flex items-center justify-center transition-colors overflow-hidden bg-[var(--color-ink-50)] group"
            aria-label="Change logo"
          >
            {logoPreview ? (
              <Image src={logoPreview} alt="Logo" fill className="object-cover" />
            ) : (
              <span className="text-[20px] opacity-30 group-hover:opacity-60 transition-opacity">🏢</span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={handleLogoChange}
          />
          <label className="flex-1 block">
            <span className={labelCls}>
              Business name <span className="text-[var(--color-bad)]">*</span>
            </span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              placeholder="e.g. Wanjiku Traders Ltd"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>KRA PIN</span>
            <input
              type="text"
              value={kraPin}
              onChange={(e) => setKraPin(e.target.value.toUpperCase())}
              className={inputCls}
              placeholder="P051234567X"
              maxLength={11}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Brand color (used on PDFs)</span>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-9 w-12 rounded-lg border border-[var(--color-ink-200)] bg-white cursor-pointer p-1"
                aria-label="Brand color"
              />
              <input
                type="text"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="w-28 rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
                placeholder="#0f766e"
                maxLength={7}
              />
            </div>
          </label>
        </div>
      </div>

      {/* Contact details */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)] mb-4">
          Contact details
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>Phone</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputCls}
              placeholder="+254 7xx xxx xxx"
            />
          </label>
          <label className="block">
            <span className={labelCls}>Business email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="info@yourco.co.ke"
            />
          </label>
          <label className="block">
            <span className={labelCls}>Website</span>
            <input
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className={inputCls}
              placeholder="yourco.co.ke"
            />
            <p className="text-[11px] text-[var(--color-ink-400)] mt-1">
              Shown as a tappable link on invoice/quote/bill PDFs.
            </p>
          </label>
          <label className="block col-span-2">
            <span className={labelCls}>Address (appears on invoices)</span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputCls}
              placeholder="P.O. Box 123, Nairobi, Kenya"
            />
          </label>
        </div>
      </div>

      {/* Security & Access */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)] mb-4">
          Security & Access
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={dataSegregation}
            onChange={(e) => setDataSegregation(e.target.checked)}
            className="accent-[var(--color-accent-500)] mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-[var(--color-ink-900)]">Enable Staff Data Segregation</div>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5 max-w-lg">
              When enabled, staff members can only view documents that they have created or have been assigned to. 
              Admins will always be able to see all data.
            </div>
          </div>
        </label>
      </div>

      {/* Approvals & Workflow */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)] mb-4">
          Approvals & Workflow
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={requireBillApproval}
            onChange={(e) => setRequireBillApproval(e.target.checked)}
            className="accent-[var(--color-accent-500)] mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-[var(--color-ink-900)]">Require approval before posting bills and expenses</div>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5 max-w-lg">
              When enabled, issuing a bill or expense sends it for approval instead of posting immediately.
              Admins can always approve; accountants can optionally be capped to a maximum amount.
            </div>
          </div>
        </label>
        {requireBillApproval && (
          <div className="mt-4 space-y-4 rounded-xl border border-[var(--color-ink-100)] bg-[var(--color-ink-50)]/60 p-4">
            <label className="block">
              <span className={labelCls}>Maximum amount accountants can approve (optional)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={accountantApprovalLimit}
                onChange={(e) => setAccountantApprovalLimit(e.target.value)}
                className={inputCls}
                placeholder="Leave blank for full approval rights"
              />
              <div className="text-[12px] text-[var(--color-ink-400)] mt-1">
                Leave this blank to let accountants approve any bill or expense just like admins. Set a value like 30000 to require admin approval above that amount.
              </div>
            </label>
            <label className="block">
              <span className={labelCls}>Approval request phone (optional)</span>
              <input
                type="tel"
                value={approvalRequestPhone}
                onChange={(e) => setApprovalRequestPhone(e.target.value)}
                className={inputCls}
                placeholder="Falls back to the business phone if left blank"
              />
              <div className="text-[12px] text-[var(--color-ink-400)] mt-1">
                When Advanta SMS is enabled, approval requests will be texted to this number with secure approve/reject links.
              </div>
            </label>
          </div>
        )}
        <div className="mt-4 pt-4 hairline-t">
          <label className="block">
            <span className={labelCls}>Gateway to use for bill / vendor payouts</span>
            <select
              value={billPayoutGatewayId}
              onChange={(e) => setBillPayoutGatewayId(e.target.value)}
              className={inputCls}
              disabled={gatewayOptions.length === 0}
            >
              <option value="">{gatewayOptions.length === 0 ? "No gateway connected yet" : "Auto — use whichever is connected"}</option>
              {gatewayOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-1">
              Pre-selects this gateway when paying a bill out — useful once you have more than one connected under Payment Gateways.
            </div>
          </label>
        </div>
        <div className="mt-4 pt-4 hairline-t">
          <label className="block">
            <span className={labelCls}>Accountant's number for payout confirmations (optional)</span>
            <input
              type="tel"
              value={accountantNotifyPhone}
              onChange={(e) => setAccountantNotifyPhone(e.target.value)}
              className={inputCls}
              placeholder="2547…"
            />
            <div className="text-[12px] text-[var(--color-ink-400)] mt-1">
              Every time a bill or expense claim is actually paid out via gateway — by anyone, admin or accountant — this number gets a text with
              the amount, destination, and gateway reference. Lets the accountant verify money moved without calling to check.
            </div>
          </label>
        </div>
        <div className="mt-4 pt-4 hairline-t">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={restrictIssuedInvoiceEdit}
              onChange={(e) => setRestrictIssuedInvoiceEdit(e.target.checked)}
              className="accent-[var(--color-accent-500)] mt-0.5"
            />
            <div>
              <div className="text-[13px] font-medium text-[var(--color-ink-900)]">Restrict who can edit issued invoices</div>
              <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5 max-w-lg">
                Off (default): anyone who can see an invoice can edit it while it's still open and has no payments against it.
                On: only the owner and the roles you pick below can. Invoices that already have a payment, or aren't open, always
                require void-and-reissue regardless of this setting.
              </div>
            </div>
          </label>
          {restrictIssuedInvoiceEdit && (
            <div className="mt-3 flex flex-wrap gap-2">
              {ROLES.filter((r) => r !== "admin").map((r) => {
                const active = issuedInvoiceEditRoles.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() =>
                      setIssuedInvoiceEditRoles((prev) =>
                        active ? prev.filter((x) => x !== r) : [...prev, r]
                      )
                    }
                    className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium border transition-colors capitalize ${
                      active
                        ? "bg-[var(--color-accent-500)] text-white border-[var(--color-accent-500)]"
                        : "bg-white text-[var(--color-ink-600)] border-[var(--color-ink-200)] hover:bg-[var(--color-ink-50)]"
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
              <span className="text-[11px] text-[var(--color-ink-400)] self-center">Admin and the owner can always edit.</span>
            </div>
          )}
        </div>
        <div className="mt-4 pt-4 hairline-t">
          <label className="block">
            <span className={labelCls}>Maximum amount an accountant can pay out on an expense claim (0 = no limit)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={expenseClaimPayoutLimit}
              onChange={(e) => setExpenseClaimPayoutLimit(e.target.value)}
              className={inputCls}
              placeholder="0"
            />
            <div className="text-[12px] text-[var(--color-ink-400)] mt-1">
              0 lets an accountant pay out any approved expense claim via gateway. Set a value like 5000 and an accountant-initiated
              payout above that amount is texted to the approval request phone above for the admin to approve (or pay themselves)
              before it goes out — admins/the owner are never limited.
            </div>
          </label>
          <label className="block mt-4">
            <span className={labelCls}>Gateway to use for automatic expense claim payouts</span>
            <select
              value={expenseClaimPayoutGatewayId}
              onChange={(e) => setExpenseClaimPayoutGatewayId(e.target.value)}
              className={inputCls}
              disabled={gatewayOptions.length === 0}
            >
              <option value="">
                {gatewayOptions.length === 0 ? "No gateway connected yet" : "Auto — use whichever is connected"}
              </option>
              {gatewayOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-1">
              {gatewayOptions.length > 1
                ? "You have more than one gateway connected — pick which one reimbursements should go out through so approving a claim pays it automatically without asking."
                : "Connect a gateway under Payment Gateways to enable automatic payouts. With more than one connected, pick which one to use here."}
            </div>
          </label>
        </div>
        <label className="flex items-start gap-3 cursor-pointer mt-4 pt-4 hairline-t">
          <input
            type="checkbox"
            checked={timeTrackingEnabled}
            onChange={(e) => setTimeTrackingEnabled(e.target.checked)}
            className="accent-[var(--color-accent-500)] mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-[var(--color-ink-900)]">Enable staff clock in / clock out</div>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5 max-w-lg">
              Adds a clock-in card to every staff member&apos;s home dashboard and tracks worked hours per shift.
            </div>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer mt-4 pt-4 hairline-t">
          <input
            type="checkbox"
            checked={itemGroupsEnabled}
            onChange={(e) => setItemGroupsEnabled(e.target.checked)}
            className="accent-[var(--color-accent-500)] mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-[var(--color-ink-900)]">Require item groups for every item</div>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5 max-w-lg">
              When enabled, products and services must be assigned to an item group. Purchase lines added into Items will also need a group, and sales reports can be broken down by item group.
            </div>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer mt-4 pt-4 hairline-t">
          <input
            type="checkbox"
            checked={customerGroupsEnabled}
            onChange={(e) => setCustomerGroupsEnabled(e.target.checked)}
            className="accent-[var(--color-accent-500)] mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-[var(--color-ink-900)]">Require customer groups for every customer</div>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5 max-w-lg">
              When enabled (default), every customer must belong to at least one customer group before they can be saved. Turn this off if your organization doesn&apos;t need customer segmentation.
            </div>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer mt-4 pt-4 hairline-t">
          <input
            type="checkbox"
            checked={bomEnabled}
            onChange={(e) => setBomEnabled(e.target.checked)}
            className="accent-[var(--color-accent-500)] mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-[var(--color-ink-900)]">Bill of Materials (products made from components)</div>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5 max-w-lg">
              Off by default. When enabled, adds a Bill of Materials section to the item form — mark a product as made from other tracked-inventory items (e.g. board + sticker), so selling it deducts each component's stock at its own FIFO cost instead of the product's own (it carries none).
            </div>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer mt-4 pt-4 hairline-t">
          <input
            type="checkbox"
            checked={blockInsufficientStock}
            onChange={(e) => setBlockInsufficientStock(e.target.checked)}
            className="accent-[var(--color-accent-500)] mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-[var(--color-ink-900)]">Block sales when stock is insufficient</div>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5 max-w-lg">
              Off by default (today, a sale silently goes through even with no stock left, costed at the last known price). When enabled, an invoice is refused if a tracked item — or, for a Bill of Materials product, any of its components — doesn't have enough stock on hand.
            </div>
          </div>
        </label>
      </div>

      {/* Tax & numbering */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)] mb-4">
          Tax & invoice numbering
        </div>
        <label className="flex items-start gap-3 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={vatRegistered}
            onChange={(e) => setVatRegistered(e.target.checked)}
            className="accent-[var(--color-accent-500)] mt-0.5"
          />
          <div>
            <div className="text-[13px] font-medium text-[var(--color-ink-900)]">VAT-registered</div>
            <div className="text-[12px] text-[var(--color-ink-400)] mt-0.5">
              Taxable turnover over KES 5M/year — invoices will charge 16% VAT
            </div>
          </div>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <span className={labelCls}>Invoice prefix</span>
            <input
              type="text"
              value={invoicePrefix}
              onChange={(e) => setInvoicePrefix(e.target.value)}
              className={inputCls}
              placeholder="INV-"
              maxLength={8}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Next Invoice Number</span>
            <input
              type="number"
              min={1}
              value={nextInvoiceNo}
              onChange={(e) => setNextInvoiceNo(Math.max(1, parseInt(e.target.value) || 1))}
              className={inputCls}
              placeholder="1001"
            />
          </label>
          <label className="block">
            <span className={labelCls}>Next Quote Number</span>
            <input
              type="number"
              min={1}
              value={nextQuoteNo}
              onChange={(e) => setNextQuoteNo(Math.max(1, parseInt(e.target.value) || 1))}
              className={inputCls}
              placeholder="1001"
            />
          </label>
        </div>
        <div className="text-[11.5px] text-[var(--color-ink-400)] mt-2">
          Set custom sequence starting numbers if your business doesn&apos;t want to start from 1 (e.g. start at 1001 for legacy system migration).
        </div>
      </div>

      {/* Document customizations */}
      <div className="card p-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)] mb-4">
          Document Customizations
        </div>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <span className={labelCls}>Invoice Template</span>
            <div className="text-[12px] text-[var(--color-ink-400)] mb-3">Choose the visual style for your invoices.</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {['default', 'accent', 'minimalist', 'beige', 'sleek', 'pastel'].map(t => (
                <TemplatePreview key={t} type={t} active={invoiceTemplate === t} onClick={() => setInvoiceTemplate(t)} color={brandColor} />
              ))}
            </div>
          </div>
          <div>
            <span className={labelCls}>Quote Template</span>
            <div className="text-[12px] text-[var(--color-ink-400)] mb-3">Choose the visual style for your quotes.</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {['default', 'accent', 'minimalist', 'beige', 'sleek', 'pastel'].map(t => (
                <TemplatePreview key={t} type={t} active={quoteTemplate === t} onClick={() => setQuoteTemplate(t)} color={brandColor} />
              ))}
            </div>
          </div>
          <label className="block mt-4">
            <span className={labelCls}>Item Categories</span>
            <div className="text-[12px] text-[var(--color-ink-400)] mb-3">
              Enable a category column on your quotes and invoices to group related items (e.g., "Design", "Printing").
            </div>
            <label className="flex items-center gap-3 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={!!customDocumentColumnName}
                onChange={(e) => setCustomDocumentColumnName(e.target.checked ? "Category" : "")}
                className="accent-[var(--color-accent-500)]"
              />
              <span className="text-[13px] font-medium">Enable Categories Column</span>
            </label>
            {!!customDocumentColumnName && (
              <div className="pl-6 border-l-2 border-[var(--color-ink-100)] ml-2">
                <span className={labelCls}>Column Name (optional override)</span>
                <input
                  type="text"
                  value={customDocumentColumnName}
                  onChange={(e) => setCustomDocumentColumnName(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Category"
                />
              </div>
            )}
          </label>
          <label className="block">
            <span className={labelCls}>Payment Information</span>
            <div className="text-[12px] text-[var(--color-ink-400)] mb-1">
              M-Pesa, bank, or other payment details shown under a bold "Payment Information" heading at the bottom of PDFs.
            </div>
            <textarea
              value={paymentInfoText}
              onChange={(e) => setPaymentInfoText(e.target.value)}
              className={inputCls + " h-24 resize-none"}
              placeholder="M-Pesa Till: 123456&#10;Bank: DTB - Account 0000000000"
            />
          </label>
          <label className="block">
            <span className={labelCls}>Terms &amp; Conditions</span>
            <div className="text-[12px] text-[var(--color-ink-400)] mb-1">
              Shown under a bold "Terms &amp; Conditions" heading at the bottom of PDFs.
            </div>
            <textarea
              value={termsText}
              onChange={(e) => setTermsText(e.target.value)}
              className={inputCls + " h-24 resize-none"}
              placeholder="Payment due within 14 days..."
            />
          </label>
          <label className="block">
            <span className={labelCls}>Contract Types &amp; Templates</span>
            <div className="text-[12px] text-[var(--color-ink-400)] mb-1">
              Managed separately now — create contract types and reusable, merge-field wording under{" "}
              <Link href="/settings/contracts" className="text-[var(--color-accent-600)] hover:underline">Settings → Contracts</Link>.
            </div>
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-[12.5px] text-[var(--color-bad)]">
          {error}
        </div>
      )}

      {saved && (
        <div className="rounded-lg bg-[var(--color-accent-50)] border border-[var(--color-accent-100)] px-4 py-3 text-[12.5px] text-[var(--color-accent-700)] font-medium">
          ✓ Settings saved
        </div>
      )}

      <button
        type="submit"
        disabled={pending || logoUploading}
        className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-60 text-white text-[13px] font-medium px-5 py-2.5 transition-colors"
      >
        {logoUploading ? "Uploading logo…" : pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}

function TemplatePreview({ type, active, onClick, color }: { type: string, active: boolean, onClick: () => void, color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full aspect-[1/1.3] rounded-lg border-2 overflow-hidden bg-white hover:border-[var(--color-accent-300)] transition-colors p-2 flex flex-col gap-1.5 ${
        active ? 'border-[var(--color-accent-500)] ring-1 ring-[var(--color-accent-500)]' : 'border-[var(--color-ink-200)]'
      }`}
    >
      {type === 'default' && (
        <>
          <div className="flex justify-between w-full h-4">
            <div className="w-6 h-6 rounded-sm bg-[var(--color-ink-200)]" />
            <div className="flex flex-col items-end gap-0.5">
              <div className="w-8 h-1.5 bg-[var(--color-ink-300)]" />
              <div className="w-12 h-1 bg-[var(--color-ink-100)]" />
            </div>
          </div>
          <div className="w-10 h-1 bg-[var(--color-ink-200)] mt-4" />
          <div className="w-full h-0.5 bg-[var(--color-ink-100)] my-1" />
          <div className="flex justify-between w-full">
            <div className="w-12 h-1 bg-[var(--color-ink-100)]" />
            <div className="w-4 h-1 bg-[var(--color-ink-100)]" />
          </div>
          <div className="flex justify-between w-full">
            <div className="w-8 h-1 bg-[var(--color-ink-100)]" />
            <div className="w-6 h-1 bg-[var(--color-ink-100)]" />
          </div>
          <div className="mt-auto flex justify-end">
            <div className="w-12 h-2" style={{ backgroundColor: color }} />
          </div>
        </>
      )}
      {type === 'accent' && (
        <>
          <div className="w-full h-8 bg-[var(--color-ink-800)] flex flex-col justify-end p-1">
             <div className="w-6 h-1.5 bg-white/80 rounded-sm mb-1" />
          </div>
          <div className="w-full h-1" style={{ backgroundColor: color }} />
          <div className="flex flex-col px-1 mt-1 gap-1">
            <div className="flex justify-between">
               <div className="w-8 h-1 bg-[var(--color-ink-300)]" />
               <div className="w-6 h-1 bg-[var(--color-ink-300)]" />
            </div>
            <div className="w-full h-2 mt-2 flex items-center" style={{ backgroundColor: color }}>
               <div className="w-8 h-0.5 bg-white ml-1" />
            </div>
            <div className="w-full h-0.5 bg-[var(--color-ink-100)] mt-1" />
            <div className="w-full h-0.5 bg-[var(--color-ink-100)]" />
            <div className="flex justify-end mt-1">
               <div className="w-8 h-1" style={{ backgroundColor: color }} />
            </div>
          </div>
        </>
      )}
      {type === 'minimalist' && (
        <>
          <div className="flex justify-between items-start p-1 w-full">
            <div className="w-6 h-6 rounded-full bg-[var(--color-ink-800)]" />
            <div className="w-10 h-2 bg-[var(--color-ink-800)]" />
          </div>
          <div className="w-full h-px bg-[var(--color-ink-100)] my-1" />
          <div className="px-1 flex flex-col gap-1 w-full">
            <div className="w-12 h-1 bg-[var(--color-ink-300)]" />
            <div className="flex justify-between items-center w-full mt-1">
              <div className="w-8 h-0.5 bg-[var(--color-ink-200)]" />
              <div className="w-6 h-0.5 bg-[var(--color-ink-200)]" />
            </div>
            <div className="flex justify-between items-center w-full">
              <div className="w-8 h-0.5 bg-[var(--color-ink-200)]" />
              <div className="w-6 h-0.5 bg-[var(--color-ink-200)]" />
            </div>
            <div className="w-full border-t border-[var(--color-ink-800)] mt-2 pt-1 flex justify-end">
               <div className="w-8 h-1 bg-[var(--color-ink-800)]" />
            </div>
          </div>
        </>
      )}
      {type === 'beige' && (
        <div className="absolute inset-0 bg-[#fdfbf7] p-2 flex flex-col items-center">
           <div className="flex justify-between w-full">
             <div className="w-8 h-1.5 bg-[var(--color-ink-800)]" />
             <div className="w-10 h-1.5" style={{ backgroundColor: color }} />
           </div>
           <div className="w-full border-b border-[var(--color-ink-800)] mt-3 mb-1" />
           <div className="w-full h-px bg-[var(--color-ink-200)] my-0.5" />
           <div className="w-full h-px bg-[var(--color-ink-200)] my-0.5" />
           <div className="mt-auto w-full flex justify-end">
             <div className="w-10 h-2 bg-[var(--color-ink-100)] flex justify-end items-center px-1 border-t border-[var(--color-ink-200)]">
                <div className="w-4 h-1 bg-[var(--color-ink-800)]" />
             </div>
           </div>
        </div>
      )}
      {type === 'sleek' && (
        <>
           <div className="flex justify-between w-full p-1 mt-1">
             <div className="flex items-center gap-1">
               <div className="w-3 h-3 bg-black" />
               <div className="w-6 h-1 bg-black" />
             </div>
             <div className="w-10 h-2 bg-black" />
           </div>
           <div className="w-full px-1 mt-1">
             <div className="w-full bg-[var(--color-ink-50)] h-4 flex items-center px-1">
                <div className="w-4 h-0.5 bg-[var(--color-ink-300)]" />
             </div>
             <div className="w-full h-px bg-black mt-2" />
             <div className="flex justify-between py-1 border-b border-[var(--color-ink-200)]">
               <div className="w-8 h-0.5 bg-[var(--color-ink-200)]" />
             </div>
             <div className="flex justify-between py-1 border-b border-[var(--color-ink-200)]">
               <div className="w-8 h-0.5 bg-[var(--color-ink-200)]" />
             </div>
           </div>
        </>
      )}
      {type === 'pastel' && (
        <>
          <div className="w-full px-1 mt-2">
            <div className="flex justify-between">
              <div className="w-6 h-1.5" style={{ backgroundColor: color }} />
              <div className="w-10 h-2" style={{ backgroundColor: color }} />
            </div>
            <div className="w-full border-t border-[var(--color-ink-200)] mt-3 pt-1">
              <div className="flex justify-between">
                <div className="w-8 h-0.5" style={{ backgroundColor: color }} />
                <div className="w-4 h-0.5" style={{ backgroundColor: color }} />
              </div>
            </div>
          </div>
          <div className="mt-auto w-full h-10 p-1 flex justify-end items-start" style={{ backgroundColor: color, opacity: 0.1 }}>
             <div className="w-6 h-1 bg-[var(--color-ink-800)]" />
          </div>
        </>
      )}
      <div className="absolute bottom-1 right-2 text-[9px] font-semibold text-[var(--color-ink-400)] capitalize">{type}</div>
    </button>
  );
}
