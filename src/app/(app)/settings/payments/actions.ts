"use server";

import { db, paymentGateways, org } from "@/db";
import { eq, and } from "drizzle-orm";
import { requirePerm } from "@/lib/guard";
import { getOrg, withOrg, currentOrgId } from "@/lib/org";
import { encryptConfig, decryptConfig } from "@/lib/payments/crypto";
import { getGateway } from "@/lib/payments/gateway";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";

export async function savePaymentGatewayAction(formData: FormData) {
  return withOrg(async () => {
    await requirePerm("settings");
    const o = await getOrg();

    const gatewayId = formData.get("gatewayId") as string;
    const environment = formData.get("environment") as string || "sandbox";
    const enabled = formData.get("enabled") === "on";

    if (!gatewayId) return { error: "Gateway ID is required" };

    let config: any = {};
    if (gatewayId === "mpesa_daraja") {
      config = {
        consumerKey: formData.get("consumerKey") as string,
        consumerSecret: formData.get("consumerSecret") as string,
        shortcode: formData.get("shortcode") as string,
        passkey: formData.get("passkey") as string,
        initiatorName: formData.get("initiatorName") as string,
        securityCredential: formData.get("securityCredential") as string,
      };
    } else if (gatewayId === "kopokopo") {
      config = {
        clientId: formData.get("clientId") as string,
        clientSecret: formData.get("clientSecret") as string,
        tillNumber: formData.get("tillNumber") as string,
        apiKey: formData.get("apiKey") as string,
      };
    }

    const existing = await db
      .select()
      .from(paymentGateways)
      .where(and(eq(paymentGateways.orgId, o.id), eq(paymentGateways.gatewayId, gatewayId)));

    if (existing.length > 0) {
      const oldConfig = decryptConfig(existing[0].configJson) || {};
      if (gatewayId === "mpesa_daraja") {
        config.consumerKey = config.consumerKey || oldConfig.consumerKey;
        config.consumerSecret = config.consumerSecret || oldConfig.consumerSecret;
        config.passkey = config.passkey || oldConfig.passkey;
        config.shortcode = config.shortcode || oldConfig.shortcode;
        config.initiatorName = config.initiatorName || oldConfig.initiatorName;
        config.securityCredential = config.securityCredential || oldConfig.securityCredential;
      } else if (gatewayId === "kopokopo") {
        config.clientId = config.clientId || oldConfig.clientId;
        config.clientSecret = config.clientSecret || oldConfig.clientSecret;
        config.apiKey = config.apiKey || oldConfig.apiKey;
        config.tillNumber = config.tillNumber || oldConfig.tillNumber;
      }
    }

    let configJson: string;
    try {
      configJson = encryptConfig(config);
    } catch (e: any) {
      return { error: e.message || "Failed to encrypt configuration. Check server logs." };
    }

    if (existing.length > 0) {
      await db.update(paymentGateways).set({
        enabled,
        environment,
        configJson,
        // Backfill for rows created before webhook auth existed
        webhookSecret: existing[0].webhookSecret || randomBytes(24).toString("hex"),
        updatedAt: new Date().toISOString(),
      }).where(eq(paymentGateways.id, existing[0].id));
    } else {
      await db.insert(paymentGateways).values({
        orgId: o.id,
        gatewayId,
        enabled,
        environment,
        configJson,
        // Authenticates inbound webhook callbacks (embedded in callback URL)
        webhookSecret: randomBytes(24).toString("hex"),
        createdAt: new Date().toISOString(),
      });
    }

    revalidatePath("/settings/payments");
    return { success: true };
  });
}

/** Records which connected gateway actually settles this org's M-Pesa till
 *  (some orgs receive M-Pesa money through Kopo Kopo, not a direct Daraja
 *  integration) — purely a label for account pickers; routing itself
 *  already keys off bankAccounts.kind='mpesa' regardless of gateway. */
export async function saveMpesaTillGatewayAction(gatewayId: string | null) {
  return withOrg(async () => {
    await requirePerm("settings");
    const orgId = currentOrgId();
    await db.update(org).set({ mpesaTillGatewayId: gatewayId || null }).where(eq(org.id, orgId));
    revalidatePath("/settings/payments");
    return { success: true };
  });
}

export async function registerC2bAction() {
  return withOrg(async () => {
    await requirePerm("settings");
    const o = await getOrg();

    const [gw] = await db.select().from(paymentGateways).where(and(
      eq(paymentGateways.orgId, o.id),
      eq(paymentGateways.gatewayId, "mpesa_daraja"),
      eq(paymentGateways.enabled, true),
    ));
    if (!gw) return { error: "Enable and save M-Pesa Daraja first" };

    const gateway = getGateway(gw);
    if (!gateway.registerC2b) return { error: "This gateway does not support C2B registration" };

    try {
      await gateway.registerC2b();
    } catch (e: any) {
      return { error: e.message || "C2B registration failed" };
    }

    await db.update(paymentGateways)
      .set({ c2bRegisteredAt: new Date().toISOString() })
      .where(eq(paymentGateways.id, gw.id));

    revalidatePath("/settings/payments");
    return { success: true };
  });
}
