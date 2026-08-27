"use server";

import { db, projectTasks, members, notifications, projects } from "@/db";
import { eq, and, asc } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { getAccess } from "@/lib/access";
import { nowISO, todayISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

/** Staff to-dos scoped to one event — site visits and anything else that
 *  comes up during the project's lifecycle. Sales/admin create them; the
 *  assignee sees a notification, same as being assigned a document. */
export async function listProjectTasks(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: projectTasks.id,
        title: projectTasks.title,
        description: projectTasks.description,
        assignedMemberId: projectTasks.assignedMemberId,
        assignedMemberName: members.name,
        dueDate: projectTasks.dueDate,
        done: projectTasks.done,
        createdAt: projectTasks.createdAt,
        completedAt: projectTasks.completedAt,
      })
      .from(projectTasks)
      .leftJoin(members, eq(members.id, projectTasks.assignedMemberId))
      .where(and(eq(projectTasks.orgId, orgId), eq(projectTasks.projectId, projectId)))
      .orderBy(asc(projectTasks.done), asc(projectTasks.dueDate), asc(projectTasks.id));
  });
}

export async function listActiveStaff() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db.select({ id: members.id, name: members.name, email: members.email })
      .from(members).where(and(eq(members.orgId, orgId), eq(members.active, true))).orderBy(asc(members.name));
    return rows.map((m) => ({ id: m.id, label: m.name || m.email }));
  });
}

export async function createTaskAction(params: {
  projectId: number;
  title: string;
  description?: string;
  assignedMemberId?: number | null;
  dueDate?: string | null;
}): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const title = params.title?.trim();
      if (!title) throw new Error("Task title is required");

      const [proj] = await db.select({ id: projects.id, name: projects.name }).from(projects)
        .where(and(eq(projects.orgId, orgId), eq(projects.id, params.projectId))).limit(1);
      if (!proj) throw new Error("Project not found");

      const access = await getAccess();
      const [row] = await db.insert(projectTasks).values({
        orgId,
        projectId: params.projectId,
        title,
        description: params.description || null,
        assignedMemberId: params.assignedMemberId ?? null,
        dueDate: params.dueDate || null,
        done: false,
        createdByMemberId: access?.memberId ?? null,
        createdAt: nowISO(),
      }).returning({ id: projectTasks.id });

      if (params.assignedMemberId) {
        await db.insert(notifications).values({
          orgId,
          memberId: params.assignedMemberId,
          title: "New task",
          body: `${title} — ${proj.name}`,
          link: `/projects/${params.projectId}?tab=tasks`,
          createdAt: nowISO(),
        });
      }

      await logAudit({ action: "project_task.create", module: "projects", recordId: row.id, recordLabel: title, projectId: params.projectId });
      revalidatePath(`/projects/${params.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not create the task" };
  }
}

export async function toggleTaskAction(id: number, done: boolean): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: projectTasks.id, projectId: projectTasks.projectId }).from(projectTasks)
        .where(and(eq(projectTasks.orgId, orgId), eq(projectTasks.id, id))).limit(1);
      if (!row) throw new Error("Task not found");

      await db.update(projectTasks).set({
        done,
        completedAt: done ? todayISO() : null,
      }).where(eq(projectTasks.id, id));

      revalidatePath(`/projects/${row.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not update the task" };
  }
}

export async function deleteTaskAction(id: number): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: projectTasks.id, projectId: projectTasks.projectId }).from(projectTasks)
        .where(and(eq(projectTasks.orgId, orgId), eq(projectTasks.id, id))).limit(1);
      if (!row) throw new Error("Task not found");

      await db.delete(projectTasks).where(eq(projectTasks.id, id));
      revalidatePath(`/projects/${row.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not delete the task" };
  }
}
