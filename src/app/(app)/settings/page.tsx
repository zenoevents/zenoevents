import { getOrg } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { db, org, paymentGateways } from "@/db";
import { eq, and } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { OrgProfileForm } from "@/components/OrgProfileForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePerm("settings");
  const o = await getOrg();
  const user = await getUser();
  if (!user) redirect("/login");


  if (!o) redirect("/onboarding");

  const connectedGateways = await db
    .select({ gatewayId: paymentGateways.gatewayId })
    .from(paymentGateways)
    .where(and(eq(paymentGateways.orgId, o.id), eq(paymentGateways.enabled, true)));
  const GATEWAY_NAMES: Record<string, string> = { mpesa_daraja: "M-Pesa Daraja", kopokopo: "Kopo Kopo" };
  const gatewayOptions = connectedGateways.map((g) => ({ id: g.gatewayId, name: GATEWAY_NAMES[g.gatewayId] || g.gatewayId }));

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="One page. That's the whole point."
      />

      <OrgProfileForm
        initial={{
          name: o.name,
          kraPin: o.kraPin,
          vatRegistered: o.vatRegistered,
          address: o.address,
          phone: o.phone,
          email: o.email,
          website: o.website,
          invoicePrefix: o.invoicePrefix,
          invoiceTemplate: o.invoiceTemplate,
          quoteTemplate: o.quoteTemplate,
          logoUrl: o.logoUrl,
          brandColor: o.brandColor,
          customDocumentColumnName: o.customDocumentColumnName,
          documentFooterText: o.documentFooterText,
          paymentInfoText: o.paymentInfoText,
          termsText: o.termsText,
          dataSegregation: o.dataSegregation,
          requireBillApproval: o.requireBillApproval,
          accountantApprovalLimitCents: o.accountantApprovalLimitCents,
          approvalRequestPhone: o.approvalRequestPhone,
          accountantNotifyPhone: o.accountantNotifyPhone,
          restrictIssuedInvoiceEdit: o.restrictIssuedInvoiceEdit,
          issuedInvoiceEditRoles: o.issuedInvoiceEditRoles,
          expenseClaimPayoutLimitCents: o.expenseClaimPayoutLimitCents,
          expenseClaimPayoutGatewayId: o.expenseClaimPayoutGatewayId,
          billPayoutGatewayId: o.billPayoutGatewayId,
          timeTrackingEnabled: o.timeTrackingEnabled,
          itemGroupsEnabled: o.itemGroupsEnabled,
          customerGroupsEnabled: o.customerGroupsEnabled,
          bomEnabled: o.bomEnabled,
          blockInsufficientStock: o.blockInsufficientStock,
          nextInvoiceNo: o.nextInvoiceNo,
          nextQuoteNo: o.nextQuoteNo,
          userId: o.userId,
        }}
        gatewayOptions={gatewayOptions}
      />

      <div className="card px-6 py-5 max-w-2xl mt-5 text-[12.5px] text-[var(--color-ink-600)] space-y-1.5">
        <div className="font-semibold text-[var(--color-ink-900)]">Kenya compliance defaults (already set up for you)</div>
        <p>· VAT rates: 16% standard, 0% zero-rated, exempt — per line item, eTIMS classes A–D.</p>
        <p>· eTIMS: invoices are signed by a <b>simulated</b> control unit (CU number + KRA QR). Connect a real OSCU/VSCU before using invoices fiscally.</p>
        <p>· Withholding: record customer WHT deductions when receiving payment — tracked as a KRA receivable.</p>
        <p>· VAT return prep and trial balance live under Reports; file on iTax by the 20th.</p>
      </div>

      <div className="card px-6 py-5 max-w-2xl mt-5 space-y-1.5 hover:bg-[var(--color-ink-50)] transition-colors cursor-pointer">
        <Link href="/settings/billing" className="block w-full">
          <div className="font-semibold text-[var(--color-ink-900)]">Billing & Subscription</div>
          <p className="text-[12.5px] text-[var(--color-ink-600)] mt-1">Manage your Zeno plan, view limits, and upgrade.</p>
        </Link>
      </div>

      <div className="card px-6 py-5 max-w-2xl mt-5 space-y-1.5 hover:bg-[var(--color-ink-50)] transition-colors cursor-pointer">
        <Link href="/settings/payments" className="block w-full">
          <div className="font-semibold text-[var(--color-ink-900)]">Payment Gateways</div>
          <p className="text-[12.5px] text-[var(--color-ink-600)] mt-1">Configure M-Pesa Daraja and Kopo Kopo for automated inbound payments.</p>
        </Link>
      </div>

      <div className="card px-6 py-5 max-w-2xl mt-5 space-y-1.5 hover:bg-[var(--color-ink-50)] transition-colors cursor-pointer">
        <Link href="/settings/sms" className="block w-full">
          <div className="font-semibold text-[var(--color-ink-900)]">SMS Receipts</div>
          <p className="text-[12.5px] text-[var(--color-ink-600)] mt-1">Text customers a secure receipt link via Advanta after every gateway payment.</p>
        </Link>
      </div>

      <div className="card px-6 py-5 max-w-2xl mt-5 space-y-1.5 hover:bg-[var(--color-ink-50)] transition-colors cursor-pointer">
        <Link href="/settings/portal" className="block w-full">
          <div className="font-semibold text-[var(--color-ink-900)]">Customer Portal (OTP)</div>
          <p className="text-[12.5px] text-[var(--color-ink-600)] mt-1">Wall QR code customers scan to access all their receipts with phone verification.</p>
        </Link>
      </div>

      <div className="card px-6 py-5 max-w-2xl mt-5 space-y-1.5 hover:bg-[var(--color-ink-50)] transition-colors cursor-pointer">
        <Link href="/settings/leads" className="block w-full">
          <div className="font-semibold text-[var(--color-ink-900)]">Lead Capture Channels</div>
          <p className="text-[12.5px] text-[var(--color-ink-600)] mt-1">Toggle Instagram, Facebook, website embed, QR codes, and WhatsApp — each hands off to one shared lead form.</p>
        </Link>
      </div>

      <div className="card px-6 py-5 max-w-2xl mt-5 space-y-1.5 hover:bg-[var(--color-ink-50)] transition-colors cursor-pointer">
        <Link href="/settings/contracts" className="block w-full">
          <div className="font-semibold text-[var(--color-ink-900)]">Contract Types &amp; Templates</div>
          <p className="text-[12.5px] text-[var(--color-ink-600)] mt-1">Create contract types and reusable, merge-field wording — picked when starting a new project contract.</p>
        </Link>
      </div>

      <div className="card px-6 py-5 max-w-2xl mt-5 space-y-1.5 hover:bg-[var(--color-ink-50)] transition-colors cursor-pointer">
        <Link href="/settings/knowledge-base" className="block w-full">
          <div className="font-semibold text-[var(--color-ink-900)]">Knowledge Base</div>
          <p className="text-[12.5px] text-[var(--color-ink-600)] mt-1">Write and publish articles for your clients to read in their dedicated Client Portal.</p>
        </Link>
      </div>
    </>
  );
}
