"use server";

import { db, projectNotes, projects } from "@/db";
import { eq, and, desc } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { getAccess } from "@/lib/access";
import { nowISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { NOTE_CATEGORIES, type NoteCategory } from "@/lib/project-note-categories";

export async function listProjectNotes(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select()
      .from(projectNotes)
      .where(and(eq(projectNotes.orgId, orgId), eq(projectNotes.projectId, projectId)))
      .orderBy(desc(projectNotes.createdAt));
  });
}

export async function createProjectNoteAction(params: {
  projectId: number;
  content: string;
  category: string;
  clientVisible: boolean;
}): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const content = params.content?.trim();
      if (!content) throw new Error("Note content is required");
      const category: NoteCategory = NOTE_CATEGORIES.includes(params.category as NoteCategory) ? (params.category as NoteCategory) : "internal";

      const [proj] = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.orgId, orgId), eq(projects.id, params.projectId))).limit(1);
      if (!proj) throw new Error("Project not found");

      const access = await getAccess();
      const [row] = await db.insert(projectNotes).values({
        orgId,
        projectId: params.projectId,
        authorMemberId: access?.memberId ?? null,
        authorName: access?.memberName || "Team",
        category,
        content,
        clientVisible: !!params.clientVisible,
        createdAt: nowISO(),
      }).returning({ id: projectNotes.id });

      await logAudit({ action: "project_note.create", module: "projects", recordId: row.id, detail: category, projectId: params.projectId });
      revalidatePath(`/projects/${params.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not save the note" };
  }
}

export async function deleteProjectNoteAction(id: number): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: projectNotes.id, projectId: projectNotes.projectId }).from(projectNotes)
        .where(and(eq(projectNotes.orgId, orgId), eq(projectNotes.id, id))).limit(1);
      if (!row) throw new Error("Note not found");
      await db.delete(projectNotes).where(eq(projectNotes.id, id));
      revalidatePath(`/projects/${row.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not delete the note" };
  }
}
