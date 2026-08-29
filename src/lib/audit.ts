import { db, orgAuditLog } from "@/db";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { getAccess } from "./access";
import { withOrg, currentOrgId } from "./org";

export type AuditModule =
  | "contacts" | "quotes" | "invoices" | "credit_notes" | "bills" | "purchase_orders"
  | "expenses" | "payments" | "banking" | "items" | "payroll" | "staff" | "settings"
  | "accountant" | "reports" | "leave_requests" | "expense_claims" | "projects" | "leads";

/**
 * Records one line in the org's audit trail. Reads the acting user off the
 * current request via getAccess() so every call site only supplies what
 * happened, not who — keeps instrumentation at action call sites cheap and
 * consistent, and impossible to spoof from the client.
 */
export async function logAudit(params: {
  action: string;
  module: AuditModule;
  recordId?: number | null;
  recordLabel?: string | null;
  detail?: string | null;
  /** Set only when the call site has an obvious project in scope (events
   *  vertical). Left out everywhere else — purely additive. */
  projectId?: number | null;
}) {
  try {
    const access = await getAccess();
    if (!access) return;
    await db.insert(orgAuditLog).values({
      orgId: access.orgId,
      actorMemberId: access.memberId,
      actorName: access.memberName,
      actorRole: access.isOwner ? "owner" : access.role,
      action: params.action,
      module: params.module,
      recordId: params.recordId ?? null,
      recordLabel: params.recordLabel ?? null,
      detail: params.detail ?? null,
      projectId: params.projectId ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    // Never let audit logging break the action it's logging.
    console.error("Audit log write failed:", e);
  }
}

export interface AuditFilters {
  from?: string;
  to?: string;
  module?: string;
  action?: string;
  actorMemberId?: number;
  q?: string;
}

/** Org-scoped audit log query — orgId is always caller-supplied from access, never client input. */
export async function listAuditLog(orgId: number, filters: AuditFilters, page: number, pageSize: number) {
  const conds = [eq(orgAuditLog.orgId, orgId)];
  if (filters.from) conds.push(gte(orgAuditLog.createdAt, filters.from));
  if (filters.to) conds.push(lte(orgAuditLog.createdAt, filters.to + "T23:59:59"));
  if (filters.module) conds.push(eq(orgAuditLog.module, filters.module));
  if (filters.action) conds.push(eq(orgAuditLog.action, filters.action));
  if (filters.actorMemberId) conds.push(eq(orgAuditLog.actorMemberId, filters.actorMemberId));
  if (filters.q) {
    conds.push(sql`(${orgAuditLog.recordLabel} ILIKE ${"%" + filters.q + "%"} OR ${orgAuditLog.detail} ILIKE ${"%" + filters.q + "%"} OR ${orgAuditLog.actorName} ILIKE ${"%" + filters.q + "%"})`);
  }

  const where = and(...conds);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(orgAuditLog).where(where).orderBy(desc(orgAuditLog.createdAt), desc(orgAuditLog.id))
      .limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(orgAuditLog).where(where),
  ]);
  return { rows, total: count };
}

/** Project-scoped audit trail for the project page's Audit Log tab — no
 *  admin gate (any project viewer sees it), simple chronological list,
 *  only rows written with a projectId (the events-vertical call sites). */
export async function listProjectAuditLog(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select()
      .from(orgAuditLog)
      .where(and(eq(orgAuditLog.orgId, orgId), eq(orgAuditLog.projectId, projectId)))
      .orderBy(desc(orgAuditLog.createdAt), desc(orgAuditLog.id))
      .limit(200);
  });
}

/** All actors who have logged an action in this org — for the filter dropdown. */
export async function listAuditActors(orgId: number) {
  const rows = await db
    .selectDistinct({ actorMemberId: orgAuditLog.actorMemberId, actorName: orgAuditLog.actorName })
    .from(orgAuditLog)
    .where(eq(orgAuditLog.orgId, orgId));
  return rows;
}
