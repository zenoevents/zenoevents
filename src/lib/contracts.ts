"use server";

import crypto from "crypto";
import { db, contracts, projects, contacts, contractTypes } from "@/db";
import { eq, and, desc } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { nowISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import type { ContractStatus } from "@/lib/contract-status";

const BUCKET = "contracts";

/**
 * Uploads a photo of the printed, signed contract to private storage — same
 * real-world pattern as damage-report photos, not a canvas e-signature pad
 * (nothing like that exists in this codebase, and a photo of a wet-ink
 * signature is what clients actually hand back today).
 */
async function uploadContractSignature(orgId: number, base64Image: string, mimeType: string): Promise<string> {
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

/** Signed, time-limited link to view a contract's signature photo — the bucket is private. */
export async function getContractSignatureUrlAction(photoPath: string): Promise<string | { error: string }> {
  try {
    return await withOrg(async () => {
      await requirePerm("contracts");
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

export async function listContractsForProject(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select()
      .from(contracts)
      .where(and(eq(contracts.orgId, orgId), eq(contracts.projectId, projectId)))
      .orderBy(desc(contracts.createdAt));
  });
}

/** Org + client details for the PDF — one row, no list overhead. */
export async function getContractForPdf(id: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db
      .select({
        id: contracts.id,
        projectId: contracts.projectId,
        subject: contracts.subject,
        valueCents: contracts.valueCents,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
        status: contracts.status,
        content: contracts.content,
        paymentTerms: contracts.paymentTerms,
        signedAt: contracts.signedAt,
        signedByName: contracts.signedByName,
        signatureMethod: contracts.signatureMethod,
        signaturePhotoPath: contracts.signaturePhotoPath,
        createdAt: contracts.createdAt,
        projectName: projects.name,
        clientName: contacts.displayName,
        clientPhone: contacts.phone,
        clientEmail: contacts.email,
        contractTypeName: contractTypes.name,
      })
      .from(contracts)
      .innerJoin(projects, eq(projects.id, contracts.projectId))
      .leftJoin(contacts, eq(contacts.id, projects.contactId))
      .leftJoin(contractTypes, eq(contractTypes.id, contracts.contractTypeId))
      .where(and(eq(contracts.orgId, orgId), eq(contracts.id, id)))
      .limit(1);
    return row ?? null;
  });
}

export async function createContractAction(projectId: number, formData: FormData): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("contracts");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [project] = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1);
      if (!project) throw new Error("Project not found");

      const subject = (formData.get("subject") as string)?.trim();
      const startDate = formData.get("startDate") as string;
      const endDate = (formData.get("endDate") as string) || null;
      const valueCents = Math.round(parseFloat((formData.get("value") as string) || "0") * 100);
      const content = (formData.get("content") as string) || null;
      const paymentTerms = (formData.get("paymentTerms") as string) || null;
      const contractTypeIdRaw = formData.get("contractTypeId") as string;
      const contractTypeId = contractTypeIdRaw ? Number(contractTypeIdRaw) : null;

      if (!subject || !startDate) throw new Error("Subject and start date are required");

      const [row] = await db.insert(contracts).values({
        orgId,
        projectId,
        subject,
        valueCents: Number.isFinite(valueCents) ? valueCents : 0,
        startDate,
        endDate,
        content,
        paymentTerms,
        contractTypeId,
        status: "draft",
        createdAt: nowISO(),
      }).returning({ id: contracts.id });

      await logAudit({ action: "contract.create", module: "projects", recordId: row.id, recordLabel: subject, projectId });
      revalidatePath(`/projects/${projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not create the contract" };
  }
}

export async function updateContractStatusAction(id: number, status: Extract<ContractStatus, "sent" | "declined" | "expired">): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("contracts");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: contracts.id, projectId: contracts.projectId }).from(contracts)
        .where(and(eq(contracts.orgId, orgId), eq(contracts.id, id))).limit(1);
      if (!row) throw new Error("Contract not found");

      await db.update(contracts).set({ status }).where(eq(contracts.id, id));
      await logAudit({ action: "contract.status", module: "projects", recordId: id, detail: status, projectId: row.projectId });
      revalidatePath(`/projects/${row.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not update the contract" };
  }
}

/** The client-signs-the-printed-copy flow: upload a photo of the wet-ink
 *  signature, record who signed, and flip status straight to "signed". */
export async function signContractAction(params: {
  id: number;
  signedByName: string;
  base64Image: string;
  mimeType: string;
}): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("contracts");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: contracts.id, projectId: contracts.projectId }).from(contracts)
        .where(and(eq(contracts.orgId, orgId), eq(contracts.id, params.id))).limit(1);
      if (!row) throw new Error("Contract not found");
      if (!params.signedByName?.trim()) throw new Error("Enter who signed");
      if (!params.base64Image) throw new Error("A photo of the signed contract is required");

      const photoPath = await uploadContractSignature(orgId, params.base64Image, params.mimeType);

      await db.update(contracts).set({
        signaturePhotoPath: photoPath,
        signedAt: nowISO(),
        signedByName: params.signedByName.trim(),
        status: "signed",
      }).where(eq(contracts.id, params.id));

      await logAudit({ action: "contract.sign", module: "projects", recordId: params.id, detail: params.signedByName, projectId: row.projectId });
      revalidatePath(`/projects/${row.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not record the signature" };
  }
}

export async function deleteContractAction(id: number): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("contracts");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: contracts.id, projectId: contracts.projectId, status: contracts.status }).from(contracts)
        .where(and(eq(contracts.orgId, orgId), eq(contracts.id, id))).limit(1);
      if (!row) throw new Error("Contract not found");
      if (row.status !== "draft") throw new Error("Only draft contracts can be deleted");

      await db.delete(contracts).where(eq(contracts.id, id));
      await logAudit({ action: "contract.delete", module: "projects", recordId: id, projectId: row.projectId });
      revalidatePath(`/projects/${row.projectId}`);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not delete the contract" };
  }
}
