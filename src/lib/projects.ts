"use server";

import { db, projects, documents, contacts, paymentSchedule, reservations, inventoryItems, items, contracts } from "@/db";
import { eq, and, inArray, sql, ne } from "drizzle-orm";
import { withOrg, currentOrgId } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { nowISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ProjectStatus } from "@/lib/project-status";
import { getManifestForProject } from "@/lib/manifests";
import { listDamageReportsForProject } from "@/lib/damage-reports";
import { LINE_STATUSES, lineFloorStage } from "@/lib/manifest-status";
import { damageReports } from "@/db";
import { type LifecycleStage } from "@/lib/lifecycle-stage";
import { saveContact } from "@/lib/actions";

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
        colorTheme: projects.colorTheme,
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
        isBillable: documents.isBillable,
        billedDocumentId: documents.billedDocumentId,
      })
      .from(documents)
      .where(and(eq(documents.orgId, orgId), eq(documents.projectId, id)))
      .orderBy(documents.date);
  });
}

/**
 * Creates a project — either against an existing client, or (mode="new")
 * creates the client inline in the same submit via saveContact(), so
 * staff never have to leave this form, create a contact elsewhere, then
 * come back. That detour was the exact gap that made a fresh project's
 * first quote/invoice dead-end on an empty customer picker: a project
 * created "still a lead" (no contactId) has nothing for the document
 * editor to pre-fill even though ?project= is set.
 * Returns instead of throwing/redirecting so the client form can show a
 * proper inline error (a bare thrown error in a plain <form action> has
 * no visible failure state — the same class of bug already found and
 * fixed once this session on the Leads stage-update form).
 */
export async function createProjectWithClientAction(formData: FormData): Promise<{ success: true; id: number } | { error: string }> {
  try {
    await requirePerm("projects");
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const name = (formData.get("name") as string)?.trim();
      const eventDate = formData.get("eventDate") as string;
      const eventType = (formData.get("eventType") as string) || null;
      const venue = (formData.get("venue") as string) || null;
      const colorTheme = (formData.get("colorTheme") as string) || null;
      const budgetCents = Math.round(parseFloat((formData.get("budget") as string) || "0") * 100);
      const notes = (formData.get("notes") as string) || null;

      if (!name || !eventDate) throw new Error("Name and event date are required");

      const mode = formData.get("mode") as string;
      let contactId: number | null = null;

      if (mode === "new") {
        const displayName = (formData.get("clientName") as string)?.trim();
        if (!displayName) throw new Error("Client name is required");
        const groupIdRaw = formData.get("clientGroupId") as string;
        contactId = await saveContact({
          kind: "customer",
          displayName,
          phone: (formData.get("clientPhone") as string) || undefined,
          email: (formData.get("clientEmail") as string) || undefined,
          groupIds: groupIdRaw ? [Number(groupIdRaw)] : [],
        });
      } else {
        const contactIdRaw = formData.get("contactId") as string;
        contactId = contactIdRaw ? parseInt(contactIdRaw, 10) : null;
      }

      const [row] = await db.insert(projects).values({
        orgId,
        contactId,
        name,
        eventType,
        venue,
        colorTheme,
        eventDate,
        budgetCents: Number.isFinite(budgetCents) ? budgetCents : 0,
        notes,
        status: "lead",
        createdAt: nowISO(),
      }).returning({ id: projects.id });

      await logAudit({ action: "project.create", module: "projects", recordId: row.id, recordLabel: name, projectId: row.id });
      revalidatePath("/projects");
      return { success: true, id: row.id };
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create this project" };
  }
}

export async function updateProjectStatusAction(id: number, status: ProjectStatus) {
  await requirePerm("projects");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, id))).limit(1);
    if (!row) throw new Error("Project not found");
    const [before] = await db.select({ status: projects.status }).from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, id))).limit(1);
    await db.update(projects).set({ status }).where(eq(projects.id, id));

    let promotedCount = 0;
    if (status === "confirmed" && before?.status !== "confirmed") {
      const quoted = await db.select({ id: reservations.id, inventoryItemId: reservations.inventoryItemId })
        .from(reservations)
        .where(and(eq(reservations.orgId, orgId), eq(reservations.projectId, id), eq(reservations.status, "quoted")));
      if (quoted.length > 0) {
        await db.update(reservations).set({ status: "booked" })
          .where(inArray(reservations.id, quoted.map((r) => r.id)));
        const itemIds = [...new Set(quoted.map((r) => r.inventoryItemId))];
        await db.update(inventoryItems).set({ status: "reserved" }).where(and(
          eq(inventoryItems.orgId, orgId),
          inArray(inventoryItems.id, itemIds),
          eq(inventoryItems.status, "in_store"),
        ));
        promotedCount = quoted.length;
      }
    }

    await logAudit({
      action: "project.status", module: "projects", recordId: id,
      detail: promotedCount > 0 ? `${status} (+${promotedCount} reservations booked)` : status,
      projectId: id,
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    revalidatePath("/projects/inventory");
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
    const colorTheme = (formData.get("colorTheme") as string) || null;
    const contactIdRaw = formData.get("contactId") as string;
    const contactId = contactIdRaw ? parseInt(contactIdRaw, 10) : null;
    const budgetCents = Math.round(parseFloat((formData.get("budget") as string) || "0") * 100);
    const notes = (formData.get("notes") as string) || null;

    if (!name || !eventDate) throw new Error("Name and event date are required");

    await db.update(projects).set({
      name, eventDate, eventType, venue, colorTheme, contactId,
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

export interface MilestoneEvent {
  date: string;
  label: string;
  icon: string;
}

/** Read-only, auto-populated timeline — no writes, nothing to break. Merges
 *  signals already tracked elsewhere (reservations, payment schedule,
 *  contracts, manifest, damage reports) into one sorted feed instead of
 *  making staff record milestones by hand. */
export async function getProjectMilestones(projectId: number): Promise<MilestoneEvent[]> {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const events: MilestoneEvent[] = [];

    const [proj] = await db.select({ createdAt: projects.createdAt, name: projects.name })
      .from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1);
    if (proj) events.push({ date: proj.createdAt, label: "Project created", icon: "🏁" });

    const resRows = await db
      .select({ startDate: reservations.startDate, createdAt: reservations.createdAt, itemName: items.name, label: inventoryItems.label, status: reservations.status })
      .from(reservations)
      .leftJoin(inventoryItems, eq(inventoryItems.id, reservations.inventoryItemId))
      .leftJoin(items, eq(items.id, inventoryItems.itemId))
      .where(and(eq(reservations.orgId, orgId), eq(reservations.projectId, projectId), ne(reservations.status, "cancelled")));
    for (const r of resRows) {
      events.push({ date: r.createdAt, label: `Reserved ${r.itemName ?? "item"} — ${r.label ?? ""} for ${r.startDate}`, icon: "📦" });
    }

    const scheduleRows = await db
      .select({ milestoneName: paymentSchedule.milestoneName, documentId: paymentSchedule.documentId, docStatus: documents.status, docDate: documents.date, docPaidCents: documents.paidCents })
      .from(paymentSchedule)
      .leftJoin(documents, eq(documents.id, paymentSchedule.documentId))
      .where(and(eq(paymentSchedule.orgId, orgId), eq(paymentSchedule.projectId, projectId)));
    for (const s of scheduleRows) {
      if (!s.documentId || !s.docDate) continue;
      events.push({ date: s.docDate, label: `Invoiced — ${s.milestoneName}`, icon: "🧾" });
      if (s.docPaidCents && s.docPaidCents > 0) {
        events.push({ date: s.docDate, label: `Payment received — ${s.milestoneName}`, icon: "💰" });
      }
    }

    const contractRows = await db.select({ subject: contracts.subject, status: contracts.status, signedAt: contracts.signedAt, createdAt: contracts.createdAt })
      .from(contracts).where(and(eq(contracts.orgId, orgId), eq(contracts.projectId, projectId)));
    for (const c of contractRows) {
      events.push({ date: c.createdAt, label: `Contract drafted — ${c.subject}`, icon: "📜" });
      if (c.signedAt) events.push({ date: c.signedAt, label: `Contract signed — ${c.subject}`, icon: "✍️" });
    }

    const manifest = await getManifestForProject(projectId);
    if (manifest) {
      events.push({ date: manifest.createdAt, label: "Manifest created", icon: "📋" });
      if (manifest.confirmedAt) events.push({ date: manifest.confirmedAt, label: "Manifest confirmed — items reserved for dispatch", icon: "✅" });
      if (manifest.reconciledAt) events.push({ date: manifest.reconciledAt, label: "Manifest reconciled — event closed out", icon: "🏁" });
    }

    const damageRows = await listDamageReportsForProject(projectId);
    for (const d of damageRows) {
      events.push({ date: d.createdAt, label: `Damage reported — ${d.itemName ?? "item"} (${d.damageType})`, icon: "⚠️" });
    }

    return events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  });
}

/** Read-only aggregates for the Overview dashboard — a synthetic lifecycle
 *  stage (combining project.status + the manifest's slowest durable line,
 *  since a manifest is only as far along as its laggard line), manifest
 *  pick-readiness, and a cost split into operational vs. damage write-off.
 *  No writes, no new tables — everything here already exists elsewhere. */
export async function getProjectOverviewStats(projectId: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [proj] = await db.select({ status: projects.status }).from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1);

    const manifest = await getManifestForProject(projectId);
    const durableLines = manifest ? manifest.lines.filter((l) => l.lineType === "durable") : [];

    let stage: LifecycleStage;
    if (!manifest) {
      stage = proj && (proj.status === "lead" || proj.status === "quoted") ? "draft" : "confirmed";
    } else if (manifest.status === "reconciled") {
      stage = "reconciled";
    } else if (durableLines.length === 0) {
      stage = "packing";
    } else {
      const floorIndex = Math.min(...durableLines.map((l) => LINE_STATUSES.indexOf(l.status as (typeof LINE_STATUSES)[number])));
      stage = lineFloorStage(LINE_STATUSES[floorIndex] ?? "pending");
    }

    const pickedCount = durableLines.filter((l) => LINE_STATUSES.indexOf(l.status as (typeof LINE_STATUSES)[number]) >= LINE_STATUSES.indexOf("picked")).length;

    const [damageWriteoff] = await db
      .select({ total: sql<number>`coalesce(sum(${damageReports.billedAmountCents}), 0)` })
      .from(damageReports)
      .where(and(eq(damageReports.orgId, orgId), eq(damageReports.projectId, projectId), eq(damageReports.billedToClient, false)));

    return {
      stage,
      cancelled: proj?.status === "cancelled",
      manifestExists: !!manifest,
      pickedCount,
      totalDurable: durableLines.length,
      manifestLines: durableLines,
      damageWriteoffCents: Number(damageWriteoff?.total ?? 0),
    };
  });
}
