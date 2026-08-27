import { getOrg } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { db, paymentGateways } from "@/db";
import { eq, and } from "drizzle-orm";
import { decryptConfig } from "@/lib/payments/crypto";
import { PageHeader } from "@/components/ui";
import { PaymentGatewayForm } from "./PaymentGatewayForm";
import { MpesaTillSettings } from "./MpesaTillSettings";
import { previewMpesaTillReconciliation } from "@/lib/mpesa-till-reconcile";

export const dynamic = "force-dynamic";

export default async function PaymentsSettingsPage() {
  await requirePerm("settings");
  const o = await getOrg();
  const user = await getUser();
  if (!user || !o) redirect("/login");

  const gateways = await db.select().from(paymentGateways).where(eq(paymentGateways.orgId, o.id));
  const connectedGatewayIds = gateways.filter((g) => g.enabled).map((g) => g.gatewayId);
  const reconcilePreview = await previewMpesaTillReconciliation();

  // The client component will handle the masked state
  const gatewaysState = gateways.map(g => {
    const conf = decryptConfig(g.configJson);
    const { webhookSecret: _secret, ...safe } = g; // never send to client
    return {
      ...safe,
      config: {
        shortcode: conf?.shortcode || "",
        tillNumber: conf?.tillNumber || "",
        hasSecrets: !!g.configJson,
      },
      configJson: g.configJson ? "********" : "" // Don't send real config back to client
    };
  });

  return (
    <>
      <div className="max-w-4xl mx-auto pb-12 min-h-[70vh]">
        <PageHeader
          title="Payment Gateways"
          subtitle="Configure incoming and outgoing payment integrations"
        />

        <div className="mt-8 space-y-8">
          <PaymentGatewayForm gateways={gatewaysState} />
          <MpesaTillSettings
            connectedGateways={connectedGatewayIds}
            initialGatewayId={o.mpesaTillGatewayId}
            preview={reconcilePreview}
          />
        </div>
      </div>
    </>
  );
}
