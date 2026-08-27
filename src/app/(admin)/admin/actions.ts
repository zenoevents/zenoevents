"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, superAdmins, subscriptions, org, announcements, manualPayments } from "@/db";
import { eq } from "drizzle-orm";
import { requireSuperAdmin } from "@/lib/super-admin";
import { logAdminAction } from "@/lib/admin-audit";
import { parseKES } from "@/lib/money";
import { runAndStoreAllOrgChecks } from "@/lib/ledger-integrity";
import { runOrgBackup, runAllOrgBackups, getBackupDownloadUrl } from "@/lib/org-backup";
import { reconcileUnconfirmedKopoKopoPayouts } from "@/lib/payments/webhook";

export async function reconcilePayoutsNow() {
  const user = await requireSuperAdmin();
  const result = await reconcileUnconfirmedKopoKopoPayouts();
  await logAdminAction({ actorEmail: user.email!, action: "reconcile_payouts_run_now", detail: `${result.checked} checked, ${result.confirmed} confirmed, ${result.reversed} reversed` });
  revalidatePath("/admin/cron");
  return result;
}

export async function runLedgerIntegrityNow() {
  const user = await requireSuperAdmin();
  const result = await runAndStoreAllOrgChecks();
  await logAdminAction({ actorEmail: user.email!, action: "ledger_integrity_run_now", detail: `${result.totalFindings} finding(s) across ${result.orgsChecked} org(s)` });
  revalidatePath("/admin/ledger-integrity");
  return result;
}

export async function runOrgBackupNow(orgId: number) {
  const user = await requireSuperAdmin();
  const result = await runOrgBackup(orgId);
  await logAdminAction({ actorEmail: user.email!, action: "org_backup_run_now", targetType: "org", targetId: orgId, detail: `${result.rowTotal} row(s), ${result.bytes} bytes` });
  revalidatePath("/admin/backups");
  return result;
}

export async function downloadOrgBackupAction(path: string) {
  await requireSuperAdmin();
  return getBackupDownloadUrl(path);
}

export async function runAllOrgBackupsNow() {
  const user = await requireSuperAdmin();
  const result = await runAllOrgBackups();
  await logAdminAction({ actorEmail: user.email!, action: "org_backup_run_all_now", detail: `${result.orgsBackedUp} backed up, ${result.failures.length} failed` });
  revalidatePath("/admin/backups");
  return result;
}

export async function stopImpersonating() {
  const user = await requireSuperAdmin();

  const cookieStore = await cookies();
  const orgId = cookieStore.get("impersonated_org_id")?.value;
  cookieStore.delete("impersonated_org_id");
  await logAdminAction({ actorEmail: user.email!, action: "impersonate_stop", targetType: "org", targetId: orgId });
  return { success: true };
}

export async function impersonateOrg(orgId: number) {
  const user = await requireSuperAdmin();

  const cookieStore = await cookies();
  // Auto-expires after 1 hour so an impersonation session can't linger forever
  cookieStore.set("impersonated_org_id", String(orgId), { path: "/", maxAge: 60 * 60 });
  await logAdminAction({ actorEmail: user.email!, action: "impersonate_start", targetType: "org", targetId: orgId });

  return { success: true };
}

export async function addSuperAdminAction(formData: FormData) {
  const user = await requireSuperAdmin();

  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address" };
  }

  const [existing] = await db.select({ id: superAdmins.id }).from(superAdmins).where(eq(superAdmins.email, email)).limit(1);
  if (existing) return { error: "Already a super admin" };

  await db.insert(superAdmins).values({
    email,
    addedBy: user.email,
    createdAt: new Date().toISOString(),
  });
  await logAdminAction({ actorEmail: user.email!, action: "super_admin_add", targetType: "super_admin", targetId: email });
  revalidatePath("/admin/team");
  return { success: true };
}

export async function removeSuperAdminAction(id: number) {
  const user = await requireSuperAdmin();

  const [row] = await db.select().from(superAdmins).where(eq(superAdmins.id, id)).limit(1);
  if (!row) return { error: "Not found" };
  // Can't remove yourself — prevents locking out the session that's doing the removing
  if (user.email && row.email === user.email.toLowerCase()) {
    return { error: "You can't remove yourself" };
  }

  await db.delete(superAdmins).where(eq(superAdmins.id, id));
  await logAdminAction({ actorEmail: user.email!, action: "super_admin_remove", targetType: "super_admin", targetId: row.email });
  revalidatePath("/admin/team");
  return { success: true };
}

/** Set an org's access-until date (comp/support tool — bypasses payment).
 *  Extend it to reactivate/extend a trial or subscription; backdate it to
 *  effectively lock the org immediately. */
export async function setAccessAction(orgId: number, formData: FormData) {
  const user = await requireSuperAdmin();

  const paidUntil = String(formData.get("paidUntil") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidUntil)) return { error: "Pick a valid date" };

  const [o] = await db.select({ id: org.id, name: org.name }).from(org).where(eq(org.id, orgId)).limit(1);
  if (!o) return { error: "Org not found" };

  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1);
  const before = existing ? existing.paidUntil : "none";
  const today = new Date().toISOString().slice(0, 10);
  const status = paidUntil >= today ? "active" : "expired";
  if (existing) {
    await db.update(subscriptions).set({ paidUntil, status }).where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({ orgId, plan: "manual", paidUntil, status, createdAt: new Date().toISOString() });
  }

  await logAdminAction({
    actorEmail: user.email!,
    action: "access_change",
    targetType: "org",
    targetId: orgId,
    detail: `${o.name || `Org #${orgId}`}: ${before} → ${paidUntil}`,
  });
  revalidatePath(`/admin/orgs/${orgId}`);
  revalidatePath("/admin/subscriptions");
  revalidatePath("/admin/revenue");
  return { success: true };
}

/** Set an org's custom one-time and/or monthly maintenance fee. */
export async function setFeesAction(orgId: number, formData: FormData) {
  const user = await requireSuperAdmin();

  const oneTimeFeeCents = Math.round(parseKES(String(formData.get("oneTimeFee") || "0")) || 0);
  const monthlyFeeCents = Math.round(parseKES(String(formData.get("monthlyFee") || "0")) || 0);
  if (oneTimeFeeCents < 0 || monthlyFeeCents < 0) return { error: "Fees can't be negative" };

  const [o] = await db.select({ id: org.id, name: org.name }).from(org).where(eq(org.id, orgId)).limit(1);
  if (!o) return { error: "Org not found" };

  await db.update(org).set({ oneTimeFeeCents, monthlyFeeCents }).where(eq(org.id, orgId));
  await logAdminAction({
    actorEmail: user.email!,
    action: "fees_change",
    targetType: "org",
    targetId: orgId,
    detail: `${o.name || `Org #${orgId}`}: one-time ${oneTimeFeeCents / 100}, monthly ${monthlyFeeCents / 100}`,
  });
  revalidatePath(`/admin/orgs/${orgId}`);
  return { success: true };
}

/** Record a payment received off-app (bank transfer, M-Pesa, cash, ...) against an org's one-time or maintenance fee. */
export async function recordManualPaymentAction(orgId: number, formData: FormData) {
  const user = await requireSuperAdmin();

  const kind = String(formData.get("kind") || "");
  if (kind !== "one_time" && kind !== "maintenance") return { error: "Invalid fee kind" };
  const amountCents = Math.round(parseKES(String(formData.get("amount") || "0")) || 0);
  if (amountCents <= 0) return { error: "Enter an amount greater than 0" };
  const paidOn = String(formData.get("paidOn") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { error: "Pick a valid date" };
  const method = String(formData.get("method") || "").trim() || null;
  const note = String(formData.get("note") || "").trim() || null;

  const [o] = await db.select({ id: org.id, name: org.name }).from(org).where(eq(org.id, orgId)).limit(1);
  if (!o) return { error: "Org not found" };

  await db.insert(manualPayments).values({
    orgId, kind, amountCents, paidOn, method, note,
    recordedByEmail: user.email,
    createdAt: new Date().toISOString(),
  });
  await logAdminAction({
    actorEmail: user.email!,
    action: "manual_payment_record",
    targetType: "org",
    targetId: orgId,
    detail: `${o.name || `Org #${orgId}`}: ${kind} ${amountCents / 100} on ${paidOn}${method ? ` via ${method}` : ""}`,
  });
  revalidatePath(`/admin/orgs/${orgId}`);
  revalidatePath("/admin/revenue");
  return { success: true };
}

export async function createAnnouncementAction(formData: FormData) {
  const user = await requireSuperAdmin();

  const message = String(formData.get("message") || "").trim();
  const tone = formData.get("tone") === "warn" ? "warn" : "info";
  if (!message) return { error: "Write a message first" };
  if (message.length > 200) return { error: "Keep it under 200 characters" };

  // One active announcement at a time — new one replaces the old
  await db.update(announcements).set({ active: false }).where(eq(announcements.active, true));
  await db.insert(announcements).values({
    message,
    tone,
    active: true,
    createdBy: user.email,
    createdAt: new Date().toISOString(),
  });
  await logAdminAction({ actorEmail: user.email!, action: "announcement_publish", detail: `[${tone}] ${message}` });
  revalidatePath("/admin/announcements");
  return { success: true };
}

export async function deactivateAnnouncementAction(id: number) {
  const user = await requireSuperAdmin();
  await db.update(announcements).set({ active: false }).where(eq(announcements.id, id));
  await logAdminAction({ actorEmail: user.email!, action: "announcement_retract", targetId: id });
  revalidatePath("/admin/announcements");
  return { success: true };
}

/** Toggle a per-org feature override (beta/pilot tool — grants the feature regardless of plan). */
export async function toggleFeatureFlagAction(orgId: number, flag: string) {
  const user = await requireSuperAdmin();

  const allowed = ["gateways", "sms", "payouts", "portal", "recurring", "payroll"];
  if (!allowed.includes(flag)) return { error: "Unknown feature" };

  const { featureFlags } = await import("@/db");
  const { and } = await import("drizzle-orm");
  const [existing] = await db.select().from(featureFlags)
    .where(and(eq(featureFlags.orgId, orgId), eq(featureFlags.flag, flag))).limit(1);

  if (existing) {
    await db.delete(featureFlags).where(eq(featureFlags.id, existing.id));
  } else {
    await db.insert(featureFlags).values({ orgId, flag, createdBy: user.email, createdAt: new Date().toISOString() });
  }
  await logAdminAction({
    actorEmail: user.email!,
    action: "feature_flag_toggle",
    targetType: "org",
    targetId: orgId,
    detail: `${flag}: ${existing ? "revoked" : "granted"}`,
  });
  revalidatePath(`/admin/orgs/${orgId}`);
  return { success: true, enabled: !existing };
}
