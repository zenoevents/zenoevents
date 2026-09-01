"use server";

import { db, contractTypes, contractTemplates } from "@/db";
import { eq, and, asc, count } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { nowISO } from "@/lib/money";
import { revalidatePath } from "next/cache";

const SETTINGS_PATH = "/settings/contracts";

export async function listContractTypes() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db.select().from(contractTypes).where(eq(contractTypes.orgId, orgId)).orderBy(asc(contractTypes.name));
  });
}

export async function createContractTypeAction(name: string): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("contracts");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const clean = name.trim();
      if (!clean) throw new Error("Enter a name");
      const [existing] = await db.select({ id: contractTypes.id }).from(contractTypes)
        .where(and(eq(contractTypes.orgId, orgId), eq(contractTypes.name, clean))).limit(1);
      if (existing) throw new Error("This type already exists");

      await db.insert(contractTypes).values({ orgId, name: clean, createdAt: nowISO() });
      revalidatePath(SETTINGS_PATH);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not create the type" };
  }
}

export async function deleteContractTypeAction(id: number): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("contracts");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: contractTypes.id }).from(contractTypes)
        .where(and(eq(contractTypes.orgId, orgId), eq(contractTypes.id, id))).limit(1);
      if (!row) throw new Error("Type not found");

      const [{ value: templateCount }] = await db.select({ value: count() }).from(contractTemplates)
        .where(and(eq(contractTemplates.orgId, orgId), eq(contractTemplates.contractTypeId, id)));
      if (templateCount > 0) throw new Error("Delete or move the templates under this type first");

      await db.delete(contractTypes).where(eq(contractTypes.id, id));
      revalidatePath(SETTINGS_PATH);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not delete the type" };
  }
}

export async function listContractTemplates(typeId?: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const conditions = [eq(contractTemplates.orgId, orgId)];
    if (typeId) conditions.push(eq(contractTemplates.contractTypeId, typeId));
    return db.select().from(contractTemplates).where(and(...conditions)).orderBy(asc(contractTemplates.name));
  });
}

export async function getContractTemplate(id: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db.select().from(contractTemplates)
      .where(and(eq(contractTemplates.orgId, orgId), eq(contractTemplates.id, id))).limit(1);
    return row ?? null;
  });
}

export async function createContractTemplateAction(formData: FormData): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("contracts");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const name = (formData.get("name") as string)?.trim();
      const contractTypeId = Number(formData.get("contractTypeId"));
      const content = (formData.get("content") as string) || null;
      const paymentTerms = (formData.get("paymentTerms") as string) || null;
      if (!name) throw new Error("Enter a template name");
      if (!contractTypeId) throw new Error("Pick a contract type");

      const [type] = await db.select({ id: contractTypes.id }).from(contractTypes)
        .where(and(eq(contractTypes.orgId, orgId), eq(contractTypes.id, contractTypeId))).limit(1);
      if (!type) throw new Error("Contract type not found");

      await db.insert(contractTemplates).values({ orgId, contractTypeId, name, content, paymentTerms, createdAt: nowISO() });
      revalidatePath(SETTINGS_PATH);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not create the template" };
  }
}

export async function updateContractTemplateAction(id: number, formData: FormData): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("contracts");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: contractTemplates.id }).from(contractTemplates)
        .where(and(eq(contractTemplates.orgId, orgId), eq(contractTemplates.id, id))).limit(1);
      if (!row) throw new Error("Template not found");

      const name = (formData.get("name") as string)?.trim();
      const contractTypeId = Number(formData.get("contractTypeId"));
      const content = (formData.get("content") as string) || null;
      const paymentTerms = (formData.get("paymentTerms") as string) || null;
      if (!name) throw new Error("Enter a template name");
      if (!contractTypeId) throw new Error("Pick a contract type");

      await db.update(contractTemplates).set({ name, contractTypeId, content, paymentTerms }).where(eq(contractTemplates.id, id));
      revalidatePath(SETTINGS_PATH);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not update the template" };
  }
}

export async function deleteContractTemplateAction(id: number): Promise<{ success: true } | { error: string }> {
  try {
    await requirePerm("contracts");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [row] = await db.select({ id: contractTemplates.id }).from(contractTemplates)
        .where(and(eq(contractTemplates.orgId, orgId), eq(contractTemplates.id, id))).limit(1);
      if (!row) throw new Error("Template not found");

      await db.delete(contractTemplates).where(eq(contractTemplates.id, id));
      revalidatePath(SETTINGS_PATH);
      return { success: true };
    });
  } catch (err: any) {
    return { error: err?.message || "Could not delete the template" };
  }
}
