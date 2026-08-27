"use server";

import crypto from "crypto";
import { db, damageReports, inventoryItems, items, projects, members, documents, manifestLines, manifests } from "@/db";
import { eq, and, ne, desc } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { getAccess } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { nowISO, todayISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { upsertDocumentAction } from "@/lib/actions";
import { revalidatePath } from "next/cache";
import type { LiabilityStatus } from "@/lib/liability-status";

const BUCKET = "damage-reports";

/**
 * Uploads the damage photo to private storage. Camera-only capture is
 * enforced client-side (capture="environment" on the file input, same
 * pattern as receipt scanning) — this action just stores whatever photo
 * comes with the report; there is no "Damaged" status without one, since
 * the caller (createDamageReportAction) requires photoPath.
 */
async function uploadDamagePhoto(orgId: number, base64Image: string, mimeType: string): Promise<string> {
  if (!mimeType.startsWith("image/")) throw new Error("Only image files are supported");
  const bytes = Buffer.from(base64Image, "base64");
  if (bytes.length > 8 * 1024 * 1024) throw new Error("Photo is too large (max 8MB)");

  const supabase = createAdminClient();
  await supabase.storage.createBucket(BUCKET, { public: false }).catch((e) => {
    if (!/already exists/i.test(e?.message || "")) throw e;
  });

  const ext = mimeType.split("/")[1]?.split("+")[0] || "jpg";
  const path = `${orgId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
  if (error) throw error;
  return path;
}

/** Signed, time-limited link to view a damage photo — the bucket is private. */
export async function getDamagePhotoUrlAction(photoPath: string): Promise<string | { error: string }> {
  try {
    return await withOrg(async () => {
      await requirePerm("projects");
      const orgId = currentOrgId();
      if (!photoPath.startsWith(`${orgId}/`)) throw new Error("Not found");
      const supabase = createAdminClient();
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(photoPath, 300);
      if (error || !data) throw error || new Error("Could not open this photo");
      return data.signedUrl;
    });
  } catch (err: any) {
    return { error: err?.message || "Could not open this photo" };
  }
}

export async function createDamageReportAction(params: {
  inventoryItemId: number;
  projectId?: number | null;
  reservationId?: number | null;
  /** Set when this report comes from inspecting a returned manifest line —
   *  the line's status flips to inspected_damaged/inspected_missing on
   *  success, closing the loop back into the checklist. */
  manifestLineId?: number | null;
  damageType: string;
  description?: string;
  stageReported: string;
  base64Image: string;
  mimeType: string;
}): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [item] = await db.select({ id: inventoryItems.id }).from(inventoryItems)
        .where(and(eq(inventoryItems.orgId, orgId), eq(inventoryItems.id, params.inventoryItemId))).limit(1);
      if (!item) throw new Error("Inventory item not found");
      if (!params.base64Image) throw new Error("A photo is required to report damage");

      const photoPath = await uploadDamagePhoto(orgId, params.base64Image, params.mimeType);
      const access = await getAccess();

      const [report] = await db.insert(damageReports).values({
        orgId,
        inventoryItemId: params.inventoryItemId,
        projectId: params.projectId ?? null,
        reservationId: params.reservationId ?? null,
        reportedByMemberId: access?.memberId ?? null,
        damageType: params.damageType,
        description: params.description || null,
        photoUrl: photoPath,
        stageReported: params.stageReported,
        liabilityStatus: "pending",
        createdAt: nowISO(),
      }).returning({ id: damageReports.id });

      await db.update(inventoryItems).set({ condition: "damaged" }).where(and(
        eq(inventoryItems.orgId, orgId), eq(inventoryItems.id, params.inventoryItemId)
      ));

      if (params.manifestLineId) {
        const [line] = await db.select({ id: manifestLines.id, manifestId: manifestLines.manifestId }).from(manifestLines)
          .where(and(eq(manifestLines.orgId, orgId), eq(manifestLines.id, params.manifestLineId))).limit(1);
        if (line) {
          await db.update(manifestLines).set({
            status: params.damageType === "missing" ? "inspected_missing" : "inspected_damaged",
            damageReportId: report.id,
            checkedByMemberId: access?.memberId ?? null,
            checkedAt: nowISO(),
          }).where(eq(manifestLines.id, line.id));
          const [manifest] = await db.select({ projectId: manifests.projectId }).from(manifests).where(eq(manifests.id, line.manifestId)).limit(1);
          if (manifest) revalidatePath(`/projects/${manifest.projectId}/manifest`);
        }
      }

      await logAudit({ action: "damage_report.create", module: "projects", recordId: params.inventoryItemId, projectId: params.projectId ?? null });
      revalidatePath("/projects/damage-reports");
      revalidatePath("/manifests");
      if (params.projectId) revalidatePath(`/projects/${params.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not submit the damage report" };
  }
}

/** Org-wide resolution queue — every report needing (or having had) a liability call. */
export async function listDamageReportsQueue() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: damageReports.id,
        itemLabel: inventoryItems.label,
        itemName: items.name,
        projectId: damageReports.projectId,
        projectName: projects.name,
        reportedByName: members.name,
        damageType: damageReports.damageType,
        description: damageReports.description,
        photoUrl: damageReports.photoUrl,
        stageReported: damageReports.stageReported,
        liabilityStatus: damageReports.liabilityStatus,
        billedToClient: damageReports.billedToClient,
        billedAmountCents: damageReports.billedAmountCents,
        documentId: damageReports.documentId,
        createdAt: damageReports.createdAt,
      })
      .from(damageReports)
      .leftJoin(inventoryItems, eq(inventoryItems.id, damageReports.inventoryItemId))
      .leftJoin(items, eq(items.id, inventoryItems.itemId))
      .leftJoin(projects, eq(projects.id, damageReports.projectId))
      .leftJoin(members, eq(members.id, damageReports.reportedByMemberId))
      .where(eq(damageReports.orgId, orgId))
      .orderBy(desc(damageReports.createdAt));
  });
}

export async function listDamageReportsForProject(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: damageReports.id,
        itemLabel: inventoryItems.label,
        itemName: items.name,
        damageType: damageReports.damageType,
        description: damageReports.description,
        stageReported: damageReports.stageReported,
        liabilityStatus: damageReports.liabilityStatus,
        photoUrl: damageReports.photoUrl,
        createdAt: damageReports.createdAt,
      })
      .from(damageReports)
      .leftJoin(inventoryItems, eq(inventoryItems.id, damageReports.inventoryItemId))
      .leftJoin(items, eq(items.id, inventoryItems.itemId))
      .where(and(eq(damageReports.orgId, orgId), eq(damageReports.projectId, projectId)))
      .orderBy(desc(damageReports.createdAt));
  });
}

export async function resolveDamageReportAction(params: {
  id: number;
  liabilityStatus: LiabilityStatus;
  billToClient: boolean;
  billedAmountCents?: number;
}): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [report] = await db.select().from(damageReports)
        .where(and(eq(damageReports.orgId, orgId), eq(damageReports.id, params.id))).limit(1);
      if (!report) throw new Error("Damage report not found");

      let documentId: number | null = null;

      if (params.billToClient) {
        if (!params.billedAmountCents || params.billedAmountCents <= 0) throw new Error("Enter an amount to bill the client");
        if (!report.projectId) throw new Error("Can't bill a client — this report isn't tied to a project");
        const [proj] = await db.select({ contactId: projects.contactId, name: projects.name })
          .from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, report.projectId))).limit(1);
        if (!proj?.contactId) throw new Error("Assign a client to this project before billing damage");

        const result = await upsertDocumentAction({
          type: "invoice",
          contactId: proj.contactId,
          date: todayISO(),
          taxInclusive: false,
          notes: `${proj.name} — damage: ${report.damageType}`,
          lines: [{
            description: `Damage — ${report.damageType}${report.description ? ` (${report.description})` : ""}`,
            qty: 1,
            unitPriceCents: params.billedAmountCents,
            discountPct: 0,
            taxClass: "D_NONVAT",
          }],
          issue: true,
        });
        if (result.error || !result.id) throw new Error(result.error || "Couldn't create the damage invoice");
        documentId = result.id;
        await db.update(documents).set({ projectId: report.projectId }).where(eq(documents.id, documentId));
      }

      const access = await getAccess();
      await db.update(damageReports).set({
        liabilityStatus: params.liabilityStatus,
        billedToClient: params.billToClient,
        billedAmountCents: params.billToClient ? (params.billedAmountCents ?? 0) : 0,
        documentId,
        resolvedByMemberId: access?.memberId ?? null,
        resolvedAt: nowISO(),
      }).where(eq(damageReports.id, params.id));

      await logAudit({ action: "damage_report.resolve", module: "projects", recordId: params.id, detail: params.liabilityStatus, projectId: report.projectId });
      revalidatePath("/projects/damage-reports");
      if (report.projectId) revalidatePath(`/projects/${report.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not resolve this report" };
  }
}
