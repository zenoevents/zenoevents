import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { db, org, accounts, bankAccounts } from "@/db";
import { eq } from "drizzle-orm";
import { getUser } from "./supabase/server";
import { SEED_ACCOUNTS } from "./coa";

export const orgContext = new AsyncLocalStorage<number>();

export function currentOrgId(): number {
  const id = orgContext.getStore();
  if (id) return id;
  // Scripts (seed/smoke) run outside a request — allow explicit env override.
  if (process.env.BIASHARA_ORG_ID) return Number(process.env.BIASHARA_ORG_ID);
  throw new Error("No organization in context — call within withOrg() or sign in.");
}

export async function getOrg() {
  // Org already resolved (inside withOrg) or script override — load by id, no auth needed.
  const ctxId =
    orgContext.getStore() ??
    (process.env.BIASHARA_ORG_ID ? Number(process.env.BIASHARA_ORG_ID) : undefined);
  if (ctxId) {
    const [row] = await db.select().from(org).where(eq(org.id, ctxId)).limit(1);
    if (row) return row;
  }
  const user = await getUser();
  if (!user) throw new Error("Not authenticated — please sign in.");
  // Super admin impersonation — resolve to the impersonated org, since the
  // admin account typically owns no org of its own.
  if (user.email) {
    const { isSuperAdmin } = await import("./super-admin");
    if (await isSuperAdmin(user.email)) {
      try {
        const { cookies } = await import("next/headers");
        const impersonatedOrgId = (await cookies()).get("impersonated_org_id")?.value;
        if (impersonatedOrgId) {
          const [row] = await db.select().from(org).where(eq(org.id, Number(impersonatedOrgId))).limit(1);
          if (row) return row;
        }
      } catch {
        // outside a request context — fall through
      }
    }
  }
  const [row] = await db.select().from(org).where(eq(org.userId, user.id)).limit(1);
  if (row) return row;
  // Staff member of someone else's org
  const { members } = await import("@/db");
  const { and: andOp } = await import("drizzle-orm");
  const [m] = await db
    .select()
    .from(members)
    .where(andOp(eq(members.userId, user.id), eq(members.active, true)))
    .limit(1);
  if (m) {
    const [memberOrg] = await db.select().from(org).where(eq(org.id, m.orgId)).limit(1);
    if (memberOrg) return memberOrg;
  }
  throw new Error("Organization not found — please complete onboarding.");
}

export async function withOrg<T>(fn: () => Promise<T>, options?: { requireWrite?: boolean }): Promise<T> {
  // Already inside an org context (nested action call) — reuse it.
  if (orgContext.getStore()) {
    if (options?.requireWrite) {
      const { getBillingAccess } = await import("./billing-server");
      const access = await getBillingAccess(orgContext.getStore()!);
      if (access.status === "locked") throw new Error("Your access is currently paused. Contact us to reactivate your account.");
    }
    return fn();
  }
  const o = await getOrg();
  if (options?.requireWrite) {
    const { getBillingAccess } = await import("./billing-server");
    const access = await getBillingAccess(o.id);
    if (access.status === "locked") throw new Error("Your access is currently paused. Contact us to reactivate your account.");
  }
  return orgContext.run(o.id, fn);
}

/**
 * Per-request memoized version of getOrg.
 * All server-render callers in the same request share one DB hit.
 */
export const getOrgCached = cache(getOrg);

/**
 * Seed a new organization with the Kenyan chart of accounts and default
 * money accounts. Idempotent — skips if the org already has accounts.
 */
export async function seedOrgDefaults(orgId: number) {
  const existing = await db.select().from(accounts).where(eq(accounts.orgId, orgId)).limit(1);
  if (existing.length > 0) return;

  const { subscriptions, itemTypes } = await import("@/db");
  const now = new Date().toISOString();

  // 7-day full-access trial, then a hard lockout until the admin
  // reactivates (manually, or via a successful "Pay now" payment).
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 7);
  await db.insert(subscriptions).values({
    orgId,
    plan: "trial",
    paidUntil: trialEnd.toISOString().slice(0, 10),
    createdAt: now,
  });

  await db.insert(itemTypes).values([
    { orgId, name: "goods", isGroupMandatory: true, isSystem: true, createdAt: now },
    { orgId, name: "service", isGroupMandatory: true, isSystem: true, createdAt: now },
    { orgId, name: "unproduced", isGroupMandatory: false, isSystem: true, createdAt: now },
  ]);

  const inserted = await db
    .insert(accounts)
    .values(
      SEED_ACCOUNTS.map((a) => ({
        orgId,
        code: a.code,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        description: a.description,
        isSystem: a.system ?? false,
      }))
    )
    .returning();

  const byCode = new Map(inserted.map((a) => [a.code, a.id]));
  await db.insert(bankAccounts).values([
    { orgId, name: "Main Bank Account", kind: "bank", accountId: byCode.get("1000")! },
    { orgId, name: "M-Pesa Till", kind: "mpesa", accountId: byCode.get("1010")! },
    { orgId, name: "Petty Cash", kind: "cash", accountId: byCode.get("1020")! },
  ]);
}

/** Ensure existing organizations also have descriptions and expanded seed accounts. */
export async function ensureExpandedChartOfAccounts(orgId: number) {
  const existing = await db.select().from(accounts).where(eq(accounts.orgId, orgId));
  const existingCodes = new Map(existing.map((a) => [a.code, a]));

  for (const s of SEED_ACCOUNTS) {
    const acct = existingCodes.get(s.code);
    if (!acct) {
      await db.insert(accounts).values({
        orgId,
        code: s.code,
        name: s.name,
        type: s.type,
        subtype: s.subtype,
        description: s.description,
        isSystem: s.system ?? false,
      });
    } else if (!acct.description && s.description) {
      await db.update(accounts).set({ description: s.description }).where(eq(accounts.id, acct.id));
    }
  }

  // Self-heal orgs created before item types existed.
  const { itemTypes } = await import("@/db");
  const existingTypes = await db.select().from(itemTypes).where(eq(itemTypes.orgId, orgId));
  const typeNames = new Set(existingTypes.map((t) => t.name));
  const now = new Date().toISOString();
  const toInsert: { orgId: number; name: string; isGroupMandatory: boolean; isSystem: boolean; createdAt: string }[] = [];
  if (!typeNames.has("goods")) toInsert.push({ orgId, name: "goods", isGroupMandatory: true, isSystem: true, createdAt: now });
  if (!typeNames.has("service")) toInsert.push({ orgId, name: "service", isGroupMandatory: true, isSystem: true, createdAt: now });
  if (!typeNames.has("unproduced")) toInsert.push({ orgId, name: "unproduced", isGroupMandatory: false, isSystem: true, createdAt: now });
  if (toInsert.length > 0) {
    await db.insert(itemTypes).values(toInsert);
  }
}
