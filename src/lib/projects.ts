"use server";

import { db, projects, documents, contacts } from "@/db";
import { eq, and, inArray, sql, ne } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { nowISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProjectStatus } from "@/lib/project-status";

export async function listProjects() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        eventType: projects.eventType,
        venue: projects.venue,
        eventDate: projects.eventDate,
        status: projects.status,
        budgetCents: projects.budgetCents,
        contactId: projects.contactId,
        clientName: contacts.displayName,
      })
      .from(projects)
      .leftJoin(contacts, eq(contacts.id, projects.contactId))
      .where(eq(projects.orgId, orgId))
      .orderBy(projects.eventDate);
    return rows;
  });
}

export async function getProject(id: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db
      .select({
        id: projects.id,
        orgId: projects.orgId,
        name: projects.name,
        eventType: projects.eventType,
        venue: projects.venue,
        eventDate: projects.eventDate,
        status: projects.status,
        budgetCents: projects.budgetCents,
        notes: projects.notes,
        contactId: projects.contactId,
        clientName: contacts.displayName,
        clientPhone: contacts.phone,
        clientEmail: contacts.email,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .leftJoin(contacts, eq(contacts.id, projects.contactId))
      .where(and(eq(projects.orgId, orgId), eq(projects.id, id)))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Mini P&L for one project, built entirely from documents already tagged
 * with this projectId — no separate ledger needed. "Cost" is every bill/
 * expense raised against the project; "invoiced"/"collected" comes from its
 * milestone invoices (Phase 3 wires payment_schedule into these same rows).
 */
export async function projectFinancials(id: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [proj] = await db.select({ budgetCents: projects.budgetCents }).from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, id))).limit(1);

    const [invoiced] = await db
      .select({ total: sql<number>`coalesce(sum(${documents.totalCents}), 0)`, paid: sql<number>`coalesce(sum(${documents.paidCents}), 0)` })
      .from(documents)
      .where(and(eq(documents.orgId, orgId), eq(documents.projectId, id), eq(documents.type, "invoice"), ne(documents.status, "void")));

    const [cost] = await db
      .select({ total: sql<number>`coalesce(sum(${documents.totalCents}), 0)` })
      .from(documents)
      .where(and(eq(documents.orgId, orgId), eq(documents.projectId, id), inArray(documents.type, ["bill", "expense"]), ne(documents.status, "void")));

    const invoicedCents = Number(invoiced?.total ?? 0);
    const collectedCents = Number(invoiced?.paid ?? 0);
    const costCents = Number(cost?.total ?? 0);

    return {
      budgetCents: proj?.budgetCents ?? 0,
      invoicedCents,
      collectedCents,
      costCents,
      marginCents: invoicedCents - costCents,
    };
  });
}

/** Every invoice/bill/expense/quote raised against this project. */
export async function projectDocuments(id: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db
      .select({
        id: documents.id,
        type: documents.type,
        number: documents.number,
        status: documents.status,
        date: documents.date,
        totalCents: documents.totalCents,
        paidCents: documents.paidCents,
      })
      .from(documents)
      .where(and(eq(documents.orgId, orgId), eq(documents.projectId, id)))
      .orderBy(documents.date);
  });
}

export async function createProjectAction(formData: FormData) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const name = (formData.get("name") as string)?.trim();
    const eventDate = formData.get("eventDate") as string;
    const eventType = (formData.get("eventType") as string) || null;
    const venue = (formData.get("venue") as string) || null;
    const contactIdRaw = formData.get("contactId") as string;
    const contactId = contactIdRaw ? parseInt(contactIdRaw, 10) : null;
    const budgetCents = Math.round(parseFloat((formData.get("budget") as string) || "0") * 100);
    const notes = (formData.get("notes") as string) || null;

    if (!name || !eventDate) throw new Error("Name and event date are required");

    const [row] = await db.insert(projects).values({
      orgId,
      contactId,
      name,
      eventType,
      venue,
      eventDate,
      budgetCents: Number.isFinite(budgetCents) ? budgetCents : 0,
      notes,
      status: "lead",
      createdAt: nowISO(),
    }).returning({ id: projects.id });

    await logAudit({ action: "project.create", module: "projects", recordId: row.id, recordLabel: name });
    revalidatePath("/projects");
    redirect(`/projects/${row.id}`);
  });
}

export async function updateProjectStatusAction(id: number, status: ProjectStatus) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, id))).limit(1);
    if (!row) throw new Error("Project not found");
    await db.update(projects).set({ status }).where(eq(projects.id, id));
    await logAudit({ action: "project.status", module: "projects", recordId: id, detail: status });
    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { success: true };
  });
}

export async function updateProjectAction(id: number, formData: FormData) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [existing] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, id))).limit(1);
    if (!existing) throw new Error("Project not found");

    const name = (formData.get("name") as string)?.trim();
    const eventDate = formData.get("eventDate") as string;
    const eventType = (formData.get("eventType") as string) || null;
    const venue = (formData.get("venue") as string) || null;
    const contactIdRaw = formData.get("contactId") as string;
    const contactId = contactIdRaw ? parseInt(contactIdRaw, 10) : null;
    const budgetCents = Math.round(parseFloat((formData.get("budget") as string) || "0") * 100);
    const notes = (formData.get("notes") as string) || null;

    if (!name || !eventDate) throw new Error("Name and event date are required");

    await db.update(projects).set({
      name, eventDate, eventType, venue, contactId,
      budgetCents: Number.isFinite(budgetCents) ? budgetCents : 0,
      notes,
    }).where(eq(projects.id, id));

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    redirect(`/projects/${id}`);
  });
}

export async function listCustomerContacts() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    return db.select({ id: contacts.id, displayName: contacts.displayName })
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), inArray(contacts.kind, ["customer", "both"]), eq(contacts.archived, false)))
      .orderBy(contacts.displayName);
  });
}
