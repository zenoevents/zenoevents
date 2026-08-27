"use server";

import crypto from "crypto";
import { db, projectFiles, members } from "@/db";
import { eq, and, desc } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { getAccess } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { nowISO, todayISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

const BUCKET = "project-files";

/** Generic file store — contracts, moodboards, anything — one bucket, path-
 *  scoped by org and project. Same private-bucket + signed-URL pattern as
 *  every other storage feature in this codebase (org-backup.ts, damage
 *  photos, contract signatures). */
async function uploadProjectFile(orgId: number, projectId: number, bytes: Buffer, mimeType: string, ext: string): Promise<string> {
  if (bytes.length > 20 * 1024 * 1024) throw new Error("File is too large (max 20MB)");

  const supabase = createAdminClient();
  await supabase.storage.createBucket(BUCKET, { public: false }).catch((e) => {
    if (!/already exists/i.test(e?.message || "")) throw e;
  });

  const path = `${orgId}/${projectId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
  if (error) throw error;
  return path;
}

/** Signed, time-limited link to view/download a file — the bucket is private. */
export async function getProjectFileUrlAction(storagePath: string): Promise<string | { error: string }> {
  try {
    return await withOrg(async () => {
      await requirePerm("projects");
      const orgId = currentOrgId();
      if (!storagePath.startsWith(`${orgId}/`)) throw new Error("Not found");
      const supabase = createAdminClient();
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300);
      if (error || !data) throw error || new Error("Could not open this file");
      return data.signedUrl;
    });
  } catch (err: any) {
    return { error: err?.message || "Could not open this file" };
  }
}

export async function listProjectFiles(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: projectFiles.id,
        filename: projectFiles.filename,
        storagePath: projectFiles.storagePath,
        docType: projectFiles.docType,
        label: projectFiles.label,
        note: projectFiles.note,
        uploadedAt: projectFiles.uploadedAt,
        uploadedByName: members.name,
      })
      .from(projectFiles)
      .leftJoin(members, eq(members.id, projectFiles.uploadedByMemberId))
      .where(and(eq(projectFiles.orgId, orgId), eq(projectFiles.projectId, projectId)))
      .orderBy(desc(projectFiles.uploadedAt), desc(projectFiles.id));
  });
}

export async function uploadProjectFileAction(params: {
  projectId: number;
  base64File: string;
  mimeType: string;
  filename: string;
  docType?: string;
  label?: string;
  note?: string;
  uploadedAt?: string;
}): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      if (!params.base64File) throw new Error("Choose a file to upload");

      const bytes = Buffer.from(params.base64File, "base64");
      const ext = params.filename.split(".").pop()?.toLowerCase() || "bin";
      const storagePath = await uploadProjectFile(orgId, params.projectId, bytes, params.mimeType, ext);
      const access = await getAccess();

      const [row] = await db.insert(projectFiles).values({
        orgId,
        projectId: params.projectId,
        storagePath,
        filename: params.filename,
        docType: params.docType || null,
        label: params.label || null,
        note: params.note || null,
        uploadedAt: params.uploadedAt || todayISO(),
        uploadedByMemberId: access?.memberId ?? null,
        createdAt: nowISO(),
      }).returning({ id: projectFiles.id });

      await logAudit({ action: "project_file.upload", module: "projects", recordId: row.id, recordLabel: params.filename, projectId: params.projectId });
      revalidatePath(`/projects/${params.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not upload the file" };
  }
}

export async function updateProjectFileAction(id: number, params: {
  label?: string;
  note?: string;
  docType?: string;
  uploadedAt?: string;
}): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: projectFiles.id, projectId: projectFiles.projectId }).from(projectFiles)
        .where(and(eq(projectFiles.orgId, orgId), eq(projectFiles.id, id))).limit(1);
      if (!row) throw new Error("File not found");

      await db.update(projectFiles).set({
        label: params.label ?? undefined,
        note: params.note ?? undefined,
        docType: params.docType ?? undefined,
        uploadedAt: params.uploadedAt || undefined,
      }).where(eq(projectFiles.id, id));

      revalidatePath(`/projects/${row.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not update the file" };
  }
}

export async function deleteProjectFileAction(id: number): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: projectFiles.id, projectId: projectFiles.projectId, storagePath: projectFiles.storagePath }).from(projectFiles)
        .where(and(eq(projectFiles.orgId, orgId), eq(projectFiles.id, id))).limit(1);
      if (!row) throw new Error("File not found");

      const supabase = createAdminClient();
      await supabase.storage.from(BUCKET).remove([row.storagePath]).catch(() => {});
      await db.delete(projectFiles).where(eq(projectFiles.id, id));

      await logAudit({ action: "project_file.delete", module: "projects", recordId: id, projectId: row.projectId });
      revalidatePath(`/projects/${row.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not delete the file" };
  }
}
