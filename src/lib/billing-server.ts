import { db, subscriptions } from "@/db";
import { eq } from "drizzle-orm";
import { resolveAccess, AccessStatus } from "./billing";

export interface BillingAccess {
  status: AccessStatus;
  paidUntil: string;
}

/** Every org's access is all-or-nothing now — active (trial or paid, no
 *  distinction shown) or locked. No subscriptions row at all (shouldn't
 *  normally happen — org.ts creates one at signup) falls back to locked
 *  rather than silently granting access. */
export async function getBillingAccess(orgId: number): Promise<BillingAccess> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1);
  if (!sub) return { status: "locked", paidUntil: new Date().toISOString().slice(0, 10) };
  return resolveAccess(sub.paidUntil);
}
