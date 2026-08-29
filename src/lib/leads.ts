"use server";

import { db, leads, leadChannels, members, notifications, contacts, contactGroupMemberships, org, referralCodes, referralRewards, customerGroups, projects } from "@/db";
import { and, eq, inArray, desc, ne } from "drizzle-orm";
import { withOrg, currentOrgId, getOrg } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { nowISO, todayISO } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { notifyOrg } from "@/lib/notifications";
import { revalidatePath } from "next/cache";
import { getOrgSmsConfig, sendSms } from "@/lib/sms";
import { qrPngDataUrl } from "@/lib/receipts/qr";
import { appOrigin } from "@/lib/receipts/tokens";
import { LEAD_CHANNELS, PUBLIC_LEAD_CHANNELS, LEAD_STAGES, type LeadChannel, type LeadStage } from "@/lib/lead-constants";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "business";
}

export async function listLeadChannels() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db.select().from(leadChannels).where(eq(leadChannels.orgId, orgId));
    const byChannel = new Map(rows.map((r) => [r.channel, r]));
    return PUBLIC_LEAD_CHANNELS.map((channel) => ({
      channel,
      enabled: byChannel.get(channel)?.enabled ?? false,
      config: (byChannel.get(channel)?.config as Record<string, unknown> | null) ?? null,
    }));
  });
}

/** Toggles a public channel on/off. Generates org.leadFormSlug on first
 *  enable of any public channel — every public channel shares one form,
 *  distinguished only by ?channel=/?campaign= query params. */
export async function setLeadChannelAction(channel: string, enabled: boolean, config?: Record<string, unknown>) {
  await requirePerm("leads");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const o = await getOrg();

    if (enabled && !o.leadFormSlug) {
      const base = slugify(o.name);
      for (let i = 0; i < 5; i++) {
        const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          await db.update(org).set({ leadFormSlug: candidate }).where(eq(org.id, orgId));
          break;
        } catch {
          // unique collision — retry with a suffix
        }
      }
    }

    const [existing] = await db.select({ id: leadChannels.id }).from(leadChannels)
      .where(and(eq(leadChannels.orgId, orgId), eq(leadChannels.channel, channel))).limit(1);
    if (existing) {
      await db.update(leadChannels).set({ enabled, ...(config !== undefined ? { config } : {}) }).where(eq(leadChannels.id, existing.id));
    } else {
      await db.insert(leadChannels).values({ orgId, channel, enabled, config: config ?? null, createdAt: nowISO() });
    }
    await logAudit({ action: enabled ? "lead_channel.enable" : "lead_channel.disable", module: "leads", recordLabel: channel });
    revalidatePath("/settings/leads");
    return { success: true };
  });
}

export async function listLeads(filters?: { stage?: string; channel?: string; assignedMemberId?: number }) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const conditions = [eq(leads.orgId, orgId)];
    if (filters?.stage) conditions.push(eq(leads.stage, filters.stage));
    if (filters?.channel) conditions.push(eq(leads.channel, filters.channel));
    if (filters?.assignedMemberId) conditions.push(eq(leads.assignedMemberId, filters.assignedMemberId));
    return db
      .select({
        id: leads.id,
        channel: leads.channel,
        channelDetail: leads.channelDetail,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        eventType: leads.eventType,
        eventDate: leads.eventDate,
        stage: leads.stage,
        assignedMemberId: leads.assignedMemberId,
        assignedMemberName: members.name,
        contactedAt: leads.contactedAt,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .leftJoin(members, eq(members.id, leads.assignedMemberId))
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt));
  });
}

export async function getLead(id: number) {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db
      .select({
        lead: leads,
        assignedMemberName: members.name,
      })
      .from(leads)
      .leftJoin(members, eq(members.id, leads.assignedMemberId))
      .where(and(eq(leads.orgId, orgId), eq(leads.id, id)))
      .limit(1);
    if (!row) return null;

    // Possible-duplicate signal: another lead or an existing contact with
    // the same phone, surfaced in the UI rather than silently merged — a
    // second inquiry can carry different details worth keeping separate.
    let possibleDuplicate: { kind: "lead" | "contact"; id: number; label: string } | null = null;
    if (row.lead.phone) {
      const [otherLead] = await db.select({ id: leads.id, name: leads.name }).from(leads)
        .where(and(eq(leads.orgId, orgId), eq(leads.phone, row.lead.phone), ne(leads.id, id))).limit(1);
      if (otherLead) possibleDuplicate = { kind: "lead", id: otherLead.id, label: otherLead.name };
      else {
        const [existingContact] = await db.select({ id: contacts.id, displayName: contacts.displayName }).from(contacts)
          .where(and(eq(contacts.orgId, orgId), eq(contacts.phone, row.lead.phone))).limit(1);
        if (existingContact) possibleDuplicate = { kind: "contact", id: existingContact.id, label: existingContact.displayName };
      }
    }

    return { ...row.lead, assignedMemberName: row.assignedMemberName, possibleDuplicate };
  });
}

/** Least-recently-assigned active "sales" member — computed from existing
 *  leads.assignedMemberId history, no separate round-robin state table. */
async function pickRoundRobinAssignee(orgId: number): Promise<number | null> {
  const salesMembers = await db.select({ id: members.id }).from(members)
    .where(and(eq(members.orgId, orgId), eq(members.active, true), eq(members.role, "sales")));
  if (salesMembers.length === 0) return null;
  if (salesMembers.length === 1) return salesMembers[0].id;

  const recentAssignments = await db.select({ assignedMemberId: leads.assignedMemberId, createdAt: leads.createdAt })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), inArray(leads.assignedMemberId, salesMembers.map((m) => m.id))))
    .orderBy(desc(leads.createdAt));
  const lastAssignedAt = new Map<number, string>();
  for (const r of recentAssignments) {
    if (r.assignedMemberId != null && !lastAssignedAt.has(r.assignedMemberId)) lastAssignedAt.set(r.assignedMemberId, r.createdAt);
  }
  // Never-yet-assigned members sort first (undefined < any date string is
  // handled by the fallback ""), then oldest-assigned.
  const sorted = [...salesMembers].sort((a, b) => (lastAssignedAt.get(a.id) ?? "").localeCompare(lastAssignedAt.get(b.id) ?? ""));
  return sorted[0].id;
}

export interface CreateLeadInput {
  channel: string;
  channelDetail?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  eventType?: string | null;
  eventDate?: string | null;
  message?: string | null;
  details?: Record<string, unknown> | null;
  referralCode?: string | null;
  /** Set for staff-initiated creation (manual entry) — skips round-robin
   *  auto-assign in favor of whoever's logged in creating it, if given. */
  assignedMemberId?: number | null;
}

/** The one shared entry point every channel submitter calls — public form
 *  action, manual-entry form, future WhatsApp webhook. */
export async function createLead(orgId: number, input: CreateLeadInput) {
  const name = input.name?.trim();
  if (!name) throw new Error("Name is required");
  if (!LEAD_CHANNELS.includes(input.channel as LeadChannel)) throw new Error("Unknown lead channel");

  let referredByContactId: number | null = null;
  let matchedReferralCodeId: number | null = null;
  if (input.referralCode) {
    const [code] = await db.select().from(referralCodes)
      .where(and(eq(referralCodes.orgId, orgId), eq(referralCodes.code, input.referralCode), eq(referralCodes.active, true))).limit(1);
    if (code) {
      referredByContactId = code.contactId;
      matchedReferralCodeId = code.id;
    }
  }

  const assignedMemberId = input.assignedMemberId ?? (await pickRoundRobinAssignee(orgId));

  const [row] = await db.insert(leads).values({
    orgId,
    channel: input.channel,
    channelDetail: input.channelDetail || null,
    name,
    phone: input.phone || null,
    email: input.email || null,
    eventType: input.eventType || null,
    eventDate: input.eventDate || null,
    message: input.message || null,
    details: input.details ?? null,
    stage: "new",
    assignedMemberId,
    referredByContactId,
    createdAt: nowISO(),
  }).returning();

  if (matchedReferralCodeId) {
    await db.insert(referralRewards).values({
      orgId, referralCodeId: matchedReferralCodeId, leadId: row.id, status: "pending", createdAt: nowISO(),
    });
  }

  if (assignedMemberId) {
    await db.insert(notifications).values({
      orgId, memberId: assignedMemberId, title: "New lead assigned",
      body: `${name} — via ${input.channel}${input.eventType ? ` (${input.eventType})` : ""}`,
      link: `/leads/${row.id}`, createdAt: nowISO(),
    });
  } else {
    await notifyOrg(orgId, ["sales"], "New lead", `${name} — via ${input.channel}, unassigned`, `/leads/${row.id}`);
  }

  if (input.phone) {
    try {
      const cfg = await getOrgSmsConfig(orgId);
      if (cfg) {
        const [o] = await db.select({ name: org.name }).from(org).where(eq(org.id, orgId)).limit(1);
        await sendSms(cfg, input.phone, `Thanks ${name.split(" ")[0]}, ${o?.name || "we"} received your inquiry${input.eventDate ? ` for ${input.eventDate}` : ""} — someone will reach out shortly.`);
      }
    } catch {
      // SMS not configured for this org, or provider error — never block lead creation on it.
    }
  }

  await logAudit({ action: "lead.create", module: "leads", recordId: row.id, recordLabel: name, detail: input.channel });
  return row;
}

/** Manual/staff-initiated entry point — "+ Add lead" button. */
export async function createLeadAction(formData: FormData) {
  await requirePerm("leads");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const row = await createLead(orgId, {
      channel: (formData.get("channel") as string) || "manual",
      channelDetail: (formData.get("channelDetail") as string) || null,
      name: (formData.get("name") as string) || "",
      phone: (formData.get("phone") as string) || null,
      email: (formData.get("email") as string) || null,
      eventType: (formData.get("eventType") as string) || null,
      eventDate: (formData.get("eventDate") as string) || null,
      message: (formData.get("message") as string) || null,
    });
    revalidatePath("/leads");
    return { success: true, id: row.id };
  });
}

export async function assignLeadAction(leadId: number, memberId: number | null) {
  await requirePerm("leads");
  return withOrg(async () => {
    const orgId = currentOrgId();
    const [row] = await db.select({ id: leads.id, name: leads.name }).from(leads)
      .where(and(eq(leads.orgId, orgId), eq(leads.id, leadId))).limit(1);
    if (!row) throw new Error("Lead not found");
    await db.update(leads).set({ assignedMemberId: memberId }).where(eq(leads.id, leadId));
    if (memberId) {
      await db.insert(notifications).values({
        orgId, memberId, title: "New lead assigned", body: row.name, link: `/leads/${leadId}`, createdAt: nowISO(),
      });
    }
    await logAudit({ action: "lead.assign", module: "leads", recordId: leadId, recordLabel: row.name });
    revalidatePath("/leads");
    revalidatePath(`/leads/${leadId}`);
    return { success: true };
  });
}

export async function updateLeadStageAction(leadId: number, stage: string, lostReason?: string) {
  await requirePerm("leads");
  return withOrg(async () => {
    const orgId = currentOrgId();
    if (!LEAD_STAGES.includes(stage as LeadStage)) throw new Error("Unknown stage");
    const [row] = await db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, leadId))).limit(1);
    if (!row) throw new Error("Lead not found");
    if (stage === "lost" && !lostReason?.trim()) throw new Error("A reason is required when marking a lead Lost");

    await db.update(leads).set({
      stage,
      lostReason: stage === "lost" ? lostReason!.trim() : null,
      contactedAt: row.contactedAt ?? (stage !== "new" ? nowISO() : null),
    }).where(eq(leads.id, leadId));

    await logAudit({ action: "lead.stage", module: "leads", recordId: leadId, recordLabel: row.name, detail: stage });
    revalidatePath("/leads");
    revalidatePath(`/leads/${leadId}`);
    return { success: true };
  });
}

/** Builds `<origin>/lead/<slug>?channel=...&campaign=...` — the one shared
 *  form URL every public channel points at, differing only by query string. */
export async function buildLeadFormUrl(channel: string, campaign?: string, ref?: string): Promise<string | null> {
  return withOrg(async () => {
    const o = await getOrg();
    if (!o.leadFormSlug) return null;
    const url = new URL(`/lead/${o.leadFormSlug}`, await appOrigin());
    url.searchParams.set("channel", channel);
    if (campaign) url.searchParams.set("campaign", campaign);
    if (ref) url.searchParams.set("ref", ref);
    return url.toString();
  });
}

/** QR image (data URL) for a source — the same shared form, source
 *  distinguished purely by the campaign label the admin types in. Covers
 *  both a boosted-post QR and a physical wedding-expo-banner QR. */
export async function generateLeadQrAction(campaign: string): Promise<{ url: string; dataUrl: string } | { error: string }> {
  await requirePerm("leads");
  const url = await buildLeadFormUrl("qr", campaign);
  if (!url) return { error: "Enable a lead channel first to generate the form link." };
  const dataUrl = await qrPngDataUrl(url);
  return { url, dataUrl };
}

/** Public-page lookup — no auth, no withOrg (there's no session). Resolves
 *  purely from the slug in the URL, never a trusted org id. Returns null if
 *  the slug doesn't match or the org hasn't enabled any public channel yet
 *  (an org with everything toggled off shouldn't have a live form). */
export async function getOrgByLeadFormSlug(slug: string) {
  const [o] = await db.select({ id: org.id, name: org.name, logoUrl: org.logoUrl, brandColor: org.brandColor })
    .from(org).where(eq(org.leadFormSlug, slug)).limit(1);
  if (!o) return null;
  const [anyEnabled] = await db.select({ id: leadChannels.id }).from(leadChannels)
    .where(and(eq(leadChannels.orgId, o.id), eq(leadChannels.enabled, true))).limit(1);
  if (!anyEnabled) return null;
  return o;
}

export interface PublicLeadSubmission {
  slug: string;
  channel: string;
  channelDetail?: string | null;
  referralCode?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  eventType?: string | null;
  eventDate?: string | null;
  message?: string | null;
  details?: Record<string, unknown> | null;
  /** Hidden honeypot field — filled means a bot. Silently dropped, not errored. */
  website2?: string;
}

/** Public submit action — no requirePerm (no session exists here). Org
 *  scoping comes entirely from the slug; the channel in the payload is
 *  cross-checked against PUBLIC_LEAD_CHANNELS so a tampered ?channel= can't
 *  smuggle in "manual"/"referral" pretending to be public traffic (referral
 *  still resolves via its own code, kept separate from public channel gating). */
export async function submitPublicLeadAction(input: PublicLeadSubmission): Promise<{ success: true } | { error: string }> {
  try {
    if (input.website2) return { success: true }; // honeypot tripped — pretend success, insert nothing
    const o = await getOrgByLeadFormSlug(input.slug);
    if (!o) return { error: "This form is no longer available." };
    const isPublicChannel = (PUBLIC_LEAD_CHANNELS as readonly string[]).includes(input.channel);
    const channel: string = input.channel === "referral" ? "referral" : isPublicChannel ? input.channel : "website";
    await createLead(o.id, {
      channel,
      channelDetail: input.channelDetail,
      name: input.name,
      phone: input.phone,
      email: input.email,
      eventType: input.eventType,
      eventDate: input.eventDate,
      message: input.message,
      details: input.details,
      referralCode: input.referralCode,
    });
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not submit — please try again." };
  }
}

/** Finds-or-creates the org's "Leads" customer group — only orgs with
 *  customerGroupsEnabled require a group on a customer at all, and the
 *  conversion flow shouldn't force the admin to pick one mid-conversion
 *  (same auto-create-by-name precedent as CSV contact import). */
async function ensureLeadsGroupId(orgId: number): Promise<number> {
  const [existing] = await db.select({ id: customerGroups.id }).from(customerGroups)
    .where(and(eq(customerGroups.orgId, orgId), eq(customerGroups.name, "Leads"))).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(customerGroups).values({ orgId, name: "Leads", createdAt: nowISO() }).returning();
  return created.id;
}

/**
 * Lead → Contact + Project. Dedupes the contact by phone (reuses an
 * existing contact rather than creating a duplicate customer record) —
 * project creation always makes a fresh project, even for a repeat client,
 * since each event is its own project regardless of who's booking it.
 * Idempotent: calling again on an already-converted lead just returns the
 * existing links rather than creating a second project.
 */
export async function convertLeadAction(leadId: number): Promise<{ contactId: number; projectId: number } | { error: string }> {
  await requirePerm("leads");
  try {
    return await withOrg(async () => {
      const orgId = currentOrgId();
      const [lead] = await db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, leadId))).limit(1);
      if (!lead) throw new Error("Lead not found");
      if (lead.convertedProjectId && lead.convertedContactId) {
        return { contactId: lead.convertedContactId, projectId: lead.convertedProjectId };
      }

      let contactId: number;
      const existing = lead.phone
        ? (await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.phone, lead.phone))).limit(1))[0]
        : undefined;
      if (existing) {
        contactId = existing.id;
      } else {
        const o = await getOrg();
        const groupIds = o.customerGroupsEnabled ? [await ensureLeadsGroupId(orgId)] : [];
        const [created] = await db.insert(contacts).values({
          orgId, kind: "customer", displayName: lead.name, phone: lead.phone || null, email: lead.email || null,
          groupId: groupIds[0] ?? null, createdAt: nowISO(),
        }).returning();
        contactId = created.id;
        if (groupIds.length > 0) {
          await db.insert(contactGroupMemberships).values(groupIds.map((gid) => ({ orgId, contactId, groupId: gid })));
        }
      }

      const [project] = await db.insert(projects).values({
        orgId, contactId,
        name: `${lead.name}${lead.eventType ? ` — ${lead.eventType}` : ""}`,
        eventType: lead.eventType,
        eventDate: lead.eventDate || todayISO(),
        notes: lead.message,
        status: "lead",
        createdAt: nowISO(),
      }).returning({ id: projects.id });

      await db.update(leads).set({
        stage: "won",
        convertedContactId: contactId,
        convertedProjectId: project.id,
        contactedAt: lead.contactedAt ?? nowISO(),
      }).where(eq(leads.id, leadId));

      // Referral reward, if this lead came in via a code — flips pending -> earned.
      const [reward] = await db.select({ id: referralRewards.id }).from(referralRewards)
        .where(and(eq(referralRewards.orgId, orgId), eq(referralRewards.leadId, leadId))).limit(1);
      if (reward) {
        await db.update(referralRewards).set({ status: "earned", projectId: project.id }).where(eq(referralRewards.id, reward.id));
      }

      await logAudit({ action: "lead.convert", module: "leads", recordId: leadId, recordLabel: lead.name, detail: `-> project #${project.id}`, projectId: project.id });
      revalidatePath("/leads");
      revalidatePath(`/leads/${leadId}`);
      revalidatePath("/projects");
      return { contactId, projectId: project.id };
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not convert this lead" };
  }
}

const CHANNEL_LABELS: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", website: "Website", whatsapp: "WhatsApp",
  qr: "QR code", manual: "Manual / Referral", referral: "Manual / Referral",
};

/** Per-channel lead counts, contact/quote/win rates, and a stage breakdown
 *  — the source performance table + chart on the Leads dashboard. Manual
 *  and referral are folded into one "Manual / Referral" row since both are
 *  staff-initiated, not ad-spend channels an admin is comparing ROI across. */
export async function sourcePerformance() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const rows = await db.select({ channel: leads.channel, stage: leads.stage }).from(leads).where(eq(leads.orgId, orgId));

    type Bucket = { total: number; new: number; contacted: number; quote_sent: number; won: number; lost: number };
    const byLabel = new Map<string, Bucket>();
    for (const r of rows) {
      const label = CHANNEL_LABELS[r.channel] ?? r.channel;
      const b = byLabel.get(label) ?? { total: 0, new: 0, contacted: 0, quote_sent: 0, won: 0, lost: 0 };
      b.total++;
      const stage = (r.stage in b ? r.stage : "new") as keyof Omit<Bucket, "total">;
      b[stage]++;
      byLabel.set(label, b);
    }

    return Array.from(byLabel.entries()).map(([label, b]) => ({
      channel: label,
      total: b.total,
      contactRate: b.total ? Math.round(((b.total - b.new) / b.total) * 100) : 0,
      quoteRate: b.total ? Math.round(((b.quote_sent + b.won) / b.total) * 100) : 0,
      winRate: b.total ? Math.round((b.won / b.total) * 100) : 0,
      stageCounts: b,
    })).sort((a, b) => b.total - a.total);
  });
}

/** Leads still "new" more than 2 hours after creation — the dashboard SLA banner. */
export async function leadSlaFlags() {
  return withOrg(async () => {
    const orgId = currentOrgId();
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    return db.select({ id: leads.id, name: leads.name, channel: leads.channel, createdAt: leads.createdAt, assignedMemberId: leads.assignedMemberId })
      .from(leads)
      .where(and(eq(leads.orgId, orgId), eq(leads.stage, "new")))
      .then((rows) => rows.filter((r) => r.createdAt < cutoff));
  });
}
