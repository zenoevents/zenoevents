import { cache } from "react";
import { db, org, members, rolePermissions, customRoles } from "@/db";
import { and, eq } from "drizzle-orm";
import { getUser } from "./supabase/server";

/**
 * Roles & module permissions.
 * The org owner (org.userId) is always an admin and cannot be locked out.
 * Staff get a role; the admin can toggle which modules each role sees —
 * toggles live in role_permissions and override the defaults below.
 */

export const ROLES = ["admin", "accountant", "sales", "hr", "inventory", "staff", "loading_staff", "warehouse_staff", "collection_staff"] as const;
export type Role = (typeof ROLES)[number];

export const MODULES: { key: string; label: string }[] = [
  { key: "dashboard", label: "Home dashboard" },
  { key: "dashboard_metrics", label: "Own metrics only (dashboard shows just their documents)" },
  { key: "contacts", label: "Customers & Vendors" },
  { key: "pipeline", label: "Deals pipeline" },
  { key: "leads", label: "Leads" },
  { key: "quotes", label: "Quotes" },
  { key: "quote_templates", label: "Quote templates" },
  { key: "invoices", label: "Invoices" },
  { key: "invoice_templates", label: "Invoice templates" },
  { key: "credit_notes", label: "Credit notes" },
  { key: "expenses", label: "Expenses" },
  { key: "expense_claims", label: "Staff expense claims" },
  { key: "leave_requests", label: "Staff leave requests" },
  { key: "manage_leave_requests", label: "Manage leave requests (view/approve everyone's, not just own)" },
  { key: "bills", label: "Bills" },
  { key: "purchase_orders", label: "Purchase orders" },
  { key: "items", label: "Items & Stock" },
  { key: "projects", label: "Projects (Events)" },
  { key: "contracts", label: "Contracts" },
  { key: "manifests", label: "Manifests (dispatch checklists)" },
  { key: "banking", label: "Bank & M-Pesa" },
  { key: "payroll", label: "Payroll" },
  { key: "fixed_assets", label: "Fixed Assets" },
  { key: "vat3", label: "iTax VAT3" },
  { key: "accountant", label: "Accountant (ledger)" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
  { key: "staff", label: "Staff & roles" },
  { key: "can_payout", label: "Gateway Payouts" },
  { key: "announcements", label: "Announcements" },
];

const ALL = MODULES.map((m) => m.key);

export const DEFAULT_ROLE_PERMS: Record<Role, string[]> = {
  admin: ALL,
  accountant: ALL.filter((k) => !["staff", "settings", "can_payout"].includes(k)),
  sales: ["dashboard", "dashboard_metrics", "contacts", "pipeline", "leads", "quotes", "quote_templates", "invoices", "invoice_templates", "credit_notes", "items", "projects", "contracts", "expense_claims", "leave_requests"],
  hr: ["dashboard", "dashboard_metrics", "contacts", "reports", "payroll", "expense_claims", "leave_requests", "announcements"],
  inventory: ["dashboard", "dashboard_metrics", "items", "purchase_orders", "bills", "contacts", "projects", "contracts", "manifests", "expense_claims", "leave_requests"],
  staff: ["dashboard", "dashboard_metrics", "projects", "contracts", "expense_claims", "leave_requests"],
  // The three operational roles from the events-vertical brainstorm — narrow
  // by design: a mobile checklist, not the full admin picture. One person
  // can hold more than one of these via custom-role stacking if needed.
  loading_staff: ["dashboard", "dashboard_metrics", "manifests", "expense_claims", "leave_requests"],
  warehouse_staff: ["dashboard", "dashboard_metrics", "manifests", "items", "expense_claims", "leave_requests"],
  collection_staff: ["dashboard", "dashboard_metrics", "manifests", "expense_claims", "leave_requests"],
};

export interface Access {
  orgId: number;
  orgRow: typeof org.$inferSelect;
  userId: string;
  isOwner: boolean;
  role: string;
  memberName: string;
  memberId: number | null;
  perms: Set<string>;
}

/** Resolve the signed-in user's org, role and effective permissions. */
export async function getAccess(): Promise<Access | null> {
  // Script/cron override (matches getOrg): no request cookies available, act
  // as the org owner/admin of BIASHARA_ORG_ID.
  if (process.env.BIASHARA_ORG_ID) {
    try {
      const { cookies } = await import("next/headers");
      await cookies();
    } catch {
      const [row] = await db
        .select()
        .from(org)
        .where(eq(org.id, Number(process.env.BIASHARA_ORG_ID)))
        .limit(1);
      if (!row) return null;
      return {
        orgId: row.id,
        orgRow: row,
        userId: row.userId ?? "script",
        isOwner: true,
        role: "admin",
        memberName: row.name,
        memberId: null,
        perms: new Set(ALL),
      };
    }
  }

  const user = await getUser();
  if (!user) return null;

  // Super Admin Impersonation
  const { isSuperAdmin } = await import("./super-admin");
  if (user.email && (await isSuperAdmin(user.email))) {
    try {
      const { cookies } = await import("next/headers");
      const cookieStore = await cookies();
      const impersonatedOrgId = cookieStore.get("impersonated_org_id")?.value;
      
      if (impersonatedOrgId) {
        const [row] = await db
          .select()
          .from(org)
          .where(eq(org.id, Number(impersonatedOrgId)))
          .limit(1);
          
        if (row) {
          return {
            orgId: row.id,
            orgRow: row,
            userId: user.id,
            isOwner: true, // act as owner
            role: "admin",
            memberName: "Super Admin",
            memberId: null,
            perms: new Set(ALL),
          };
        }
      }
    } catch {
      // Ignore if not in a request context
    }
  }

  // Owner path
  const [owned] = await db.select().from(org).where(eq(org.userId, user.id)).limit(1);
  if (owned) {
    return {
      orgId: owned.id,
      orgRow: owned,
      userId: user.id,
      isOwner: true,
      role: "admin",
      memberName: owned.name,
      memberId: null, // owner might not have a member record unless created
      perms: new Set(ALL),
    };
  }

  // Staff path
  const [m] = await db
    .select()
    .from(members)
    .where(and(eq(members.userId, user.id), eq(members.active, true)))
    .limit(1);
  if (!m) return null;
  const [o] = await db.select().from(org).where(eq(org.id, m.orgId)).limit(1);
  if (!o) return null;

  const role = m.role;
  const defaultPerms = DEFAULT_ROLE_PERMS[role as Role] || [];
  const perms = new Set(defaultPerms);
  if (role !== "admin") {
    const overrides = await db
      .select()
      .from(rolePermissions)
      .where(and(eq(rolePermissions.orgId, m.orgId), eq(rolePermissions.role, role)));
    for (const ov of overrides) {
      if (ov.allowed) perms.add(ov.permKey);
      else perms.delete(ov.permKey);
    }
    perms.add("dashboard"); // never lock anyone out of home
  }

  return {
    orgId: m.orgId,
    orgRow: o,
    userId: user.id,
    isOwner: false,
    role,
    memberName: m.name || m.email,
    memberId: m.id,
    perms: role === "admin" ? new Set(ALL) : perms,
  };
}

/** Effective permission map for a role (defaults + org overrides). */
export async function rolePermMap(orgId: number, role: string): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = {};
  const defaultPerms = DEFAULT_ROLE_PERMS[role as Role] || [];
  for (const m of MODULES) map[m.key] = defaultPerms.includes(m.key);
  const overrides = await db
    .select()
    .from(rolePermissions)
    .where(and(eq(rolePermissions.orgId, orgId), eq(rolePermissions.role, role)));
  for (const ov of overrides) map[ov.permKey] = ov.allowed;
  return map;
}

/**
 * Per-request memoized access check.
 * The layout and any server component calling this in the same render
 * share a single set of DB queries instead of each hitting the DB.
 */
export const getAccessCached = cache(getAccess);

export function canViewAllData(access: Access): boolean {
  if (access.isOwner || access.role === "admin") return true;
  if (!access.orgRow.dataSegregation) return true;
  return false;
}

/** Get all system and custom roles for an organization. */
export async function getAllRoles(orgId: number): Promise<string[]> {
  const custom = await db.select().from(customRoles).where(eq(customRoles.orgId, orgId));
  const uniqueCustom = Array.from(new Set(custom.map((c) => c.name)));
  return [...ROLES, ...uniqueCustom];
}
