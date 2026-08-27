import { redirect } from "next/navigation";
import { db, members, employees, org } from "@/db";
import { eq } from "drizzle-orm";
import { getAccess, MODULES, rolePermMap, getAllRoles } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { AddStaffForm, StaffList, PermissionMatrix, CreateRoleForm } from "@/components/StaffManager";
import { DashboardVisibilityToggles } from "@/components/DashboardVisibilityToggles";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const access = await getAccess();
  if (!access) redirect("/login");
  if (access.role !== "admin") redirect("/");

  const [orgRow] = await db.select().from(org).where(eq(org.id, access.orgId)).limit(1);
  const staff = await db.select().from(members).where(eq(members.orgId, access.orgId));
  const allEmployees = await db.select().from(employees).where(eq(employees.orgId, access.orgId));

  const allRoles = await getAllRoles(access.orgId);
  const editableRoles = allRoles.filter((r) => r !== "admin");

  const matrix: Record<string, Record<string, boolean>> = {};
  for (const r of editableRoles) {
    matrix[r] = await rolePermMap(access.orgId, r);
  }

  const serviceKeyMissing = !process.env.SUPABASE_SERVICE_ROLE_KEY;

  return (
    <>
      <PageHeader
        title="Staff & Roles"
        subtitle="Create accounts for your team and control what each role can see"
      />

      {serviceKeyMissing && (
        <div className="mb-5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-[12.5px] text-amber-800">
          <b>Setup needed:</b> add <code>SUPABASE_SERVICE_ROLE_KEY</code> to your environment
          (Supabase dashboard → Settings → API → service_role) to enable creating staff accounts.
          Role toggles below work already.
        </div>
      )}

      <h2 className="text-[15px] font-semibold mb-3">Add a staff member</h2>
      <AddStaffForm 
        roles={allRoles} 
        employees={allEmployees.map(e => ({ id: e.id, name: e.name }))}
        isLocked={false}
      />

      <h2 className="text-[15px] font-semibold mt-8 mb-3">Team</h2>
      <StaffList
        staff={staff.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, active: m.active }))}
        roles={allRoles}
      />

      <div className="flex items-center justify-between mt-8 mb-1">
        <h2 className="text-[15px] font-semibold">What each role can see</h2>
        <CreateRoleForm />
      </div>
      <p className="text-[12.5px] text-[var(--color-ink-400)] mb-3">
        Toggle modules per role — changes apply to everyone with that role immediately.
        Admins always see everything.
      </p>
      <PermissionMatrix key={editableRoles.join(",")} roles={editableRoles} modules={MODULES} matrix={matrix} />

      <h2 className="text-[15px] font-semibold mt-8 mb-3">Staff home dashboard</h2>
      <DashboardVisibilityToggles
        showCollectedThisYearCard={orgRow?.showCollectedThisYearCard ?? true}
        showInvoiceCollectionTotals={orgRow?.showInvoiceCollectionTotals ?? true}
      />
    </>
  );
}
