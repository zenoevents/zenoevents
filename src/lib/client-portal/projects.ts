import { db, projects, documents, contracts, paymentSchedule, projectNotes, payments } from "@/db";
import { and, eq, desc, inArray, sql } from "drizzle-orm";

/**
 * Plain orgId/contactId-parameter reads for the client portal — no
 * withOrg(), since a portal session is a client identity (JWT), not a
 * staff Supabase session, so currentOrgId()/getOrg() have nothing to read.
 * Every function here re-checks ownership itself rather than trusting the
 * caller, mirroring createLead(orgId, input)'s precedent for public/portal
 * code that can't use the staff-scoped withOrg() helpers.
 */

export async function listClientProjects(orgId: number, contactId: number) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      eventType: projects.eventType,
      venue: projects.venue,
      eventDate: projects.eventDate,
      status: projects.status,
      colorTheme: projects.colorTheme,
      budgetCents: projects.budgetCents,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.contactId, contactId)))
    .orderBy(desc(projects.eventDate));
}

export async function getClientProject(orgId: number, contactId: number, projectId: number) {
  const [row] = await db
    .select({
      id: projects.id,
      name: projects.name,
      eventType: projects.eventType,
      venue: projects.venue,
      eventDate: projects.eventDate,
      status: projects.status,
      colorTheme: projects.colorTheme,
      budgetCents: projects.budgetCents,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.contactId, contactId), eq(projects.id, projectId)))
    .limit(1);
  return row ?? null;
}

export async function getClientPaymentSchedule(orgId: number, projectId: number) {
  return db
    .select({
      id: paymentSchedule.id,
      milestoneName: paymentSchedule.milestoneName,
      sequenceOrder: paymentSchedule.sequenceOrder,
      amountType: paymentSchedule.amountType,
      percentageValue: paymentSchedule.percentageValue,
      fixedAmountCents: paymentSchedule.fixedAmountCents,
      documentId: paymentSchedule.documentId,
      docNumber: documents.number,
      docStatus: documents.status,
      docTotalCents: documents.totalCents,
      docPaidCents: documents.paidCents,
    })
    .from(paymentSchedule)
    .leftJoin(documents, eq(documents.id, paymentSchedule.documentId))
    .where(and(eq(paymentSchedule.orgId, orgId), eq(paymentSchedule.projectId, projectId)))
    .orderBy(paymentSchedule.sequenceOrder);
}

/** Invoices/quotes only — never bills/expenses (the org's internal costs,
 *  not client-facing). Filtered by contactId too, defense in depth on top
 *  of the project-ownership check the caller already did. */
export async function getClientProjectDocuments(orgId: number, contactId: number, projectId: number) {
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
    .where(and(
      eq(documents.orgId, orgId),
      eq(documents.projectId, projectId),
      eq(documents.contactId, contactId),
      inArray(documents.type, ["invoice", "quote"]),
    ))
    .orderBy(desc(documents.date));
}

/** Client-visible notes only — view-only by design (no create/edit action
 *  exists on this side at all, not just a hidden UI control). */
export async function getClientProjectNotes(orgId: number, projectId: number) {
  return db
    .select()
    .from(projectNotes)
    .where(and(eq(projectNotes.orgId, orgId), eq(projectNotes.projectId, projectId), eq(projectNotes.clientVisible, true)))
    .orderBy(desc(projectNotes.createdAt));
}

export async function getClientProjectContracts(orgId: number, projectId: number) {
  return db
    .select()
    .from(contracts)
    .where(and(eq(contracts.orgId, orgId), eq(contracts.projectId, projectId)))
    .orderBy(desc(contracts.createdAt));
}

interface TimelineEvent {
  date: string;
  label: string;
  icon: string;
}

/** Client-safe timeline — deliberately a separate, smaller function from
 *  staff's getProjectMilestones(), not a filtered reuse of it. Excludes
 *  reservations, manifest/warehouse internals, and damage reports. */
export async function getClientProjectTimeline(orgId: number, projectId: number): Promise<TimelineEvent[]> {
  const [project, contractRows, scheduleRows] = await Promise.all([
    db.select({ eventDate: projects.eventDate, status: projects.status, createdAt: projects.createdAt })
      .from(projects).where(and(eq(projects.orgId, orgId), eq(projects.id, projectId))).limit(1).then((r) => r[0]),
    db.select({ subject: contracts.subject, status: contracts.status, createdAt: contracts.createdAt, signedAt: contracts.signedAt })
      .from(contracts).where(and(eq(contracts.orgId, orgId), eq(contracts.projectId, projectId))),
    db.select({ milestoneName: paymentSchedule.milestoneName, documentId: paymentSchedule.documentId, docStatus: documents.status, docDate: documents.date, docPaidCents: documents.paidCents, docTotalCents: documents.totalCents })
      .from(paymentSchedule).leftJoin(documents, eq(documents.id, paymentSchedule.documentId))
      .where(and(eq(paymentSchedule.orgId, orgId), eq(paymentSchedule.projectId, projectId))),
  ]);

  const events: TimelineEvent[] = [];
  if (project) {
    events.push({ date: project.createdAt.slice(0, 10), label: "Booking created", icon: "📋" });
    if (project.status === "confirmed" || project.status === "in_progress" || project.status === "completed") {
      events.push({ date: project.createdAt.slice(0, 10), label: "Booking confirmed", icon: "✅" });
    }
    events.push({ date: project.eventDate, label: "Event date", icon: "🎉" });
  }
  for (const c of contractRows) {
    events.push({ date: c.createdAt.slice(0, 10), label: `Contract sent — ${c.subject}`, icon: "📄" });
    if (c.status === "signed" && c.signedAt) events.push({ date: c.signedAt.slice(0, 10), label: `Contract signed — ${c.subject}`, icon: "✍️" });
    if (c.status === "declined") events.push({ date: c.createdAt.slice(0, 10), label: `Contract declined — ${c.subject}`, icon: "❌" });
  }
  for (const m of scheduleRows) {
    if (!m.documentId || !m.docDate) continue;
    const paid = (m.docPaidCents ?? 0) >= (m.docTotalCents ?? 0) && (m.docTotalCents ?? 0) > 0;
    events.push({ date: m.docDate, label: `${m.milestoneName} invoiced`, icon: "🧾" });
    if (paid) events.push({ date: m.docDate, label: `${m.milestoneName} paid`, icon: "💰" });
  }

  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Monthly received-payments trend, trailing N months — the Overview
 *  page's hero chart. Direction "in" only (customer payments), across
 *  every project/document, not scoped to one. */
export async function getClientPaymentsTrend(orgId: number, contactId: number, months = 6) {
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1);
  const sinceStr = since.toISOString().slice(0, 10);

  const rows = await db.select({ date: payments.date, amountCents: payments.amountCents })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), eq(payments.contactId, contactId), eq(payments.direction, "in"), sql`${payments.date} >= ${sinceStr}`));

  const buckets: { label: string; collected: number }[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ label: d.toLocaleDateString("en-KE", { month: "short" }), collected: 0 });
  }
  for (const r of rows) {
    const d = new Date(r.date);
    const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    const idx = months - 1 - monthsAgo;
    if (idx >= 0 && idx < buckets.length) buckets[idx].collected += r.amountCents;
  }
  return buckets;
}

/** Cross-project aggregate stats for the Overview page — active project
 *  count, total collected/outstanding across every real invoice, and the
 *  soonest upcoming event. */
export async function getClientDashboardStats(orgId: number, contactId: number) {
  const [projectRows, docRows] = await Promise.all([
    db.select({ id: projects.id, name: projects.name, status: projects.status, eventDate: projects.eventDate })
      .from(projects).where(and(eq(projects.orgId, orgId), eq(projects.contactId, contactId))),
    db.select({ status: documents.status, totalCents: documents.totalCents, paidCents: documents.paidCents, dueDate: documents.dueDate, type: documents.type })
      .from(documents).where(and(eq(documents.orgId, orgId), eq(documents.contactId, contactId), eq(documents.type, "invoice"))),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const activeProjects = projectRows.filter((p) => p.status !== "cancelled" && p.status !== "completed");
  const upcoming = activeProjects.filter((p) => p.eventDate >= today).sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1));

  const realInvoices = docRows.filter((d) => d.status !== "draft" && d.status !== "void");
  const totalInvoicedCents = realInvoices.reduce((s, d) => s + d.totalCents, 0);
  const totalCollectedCents = realInvoices.reduce((s, d) => s + d.paidCents, 0);
  const outstandingCents = Math.max(0, totalInvoicedCents - totalCollectedCents);
  const unpaidCount = realInvoices.filter((d) => ["open", "partial"].includes(d.status)).length;
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const eventsIn30Days = upcoming.filter((p) => p.eventDate <= in30Days).length;

  return {
    activeProjectCount: activeProjects.length,
    totalInvoicedCents,
    totalCollectedCents,
    outstandingCents,
    unpaidCount,
    eventsIn30Days,
    nextEvent: upcoming[0] ?? null,
  };
}
