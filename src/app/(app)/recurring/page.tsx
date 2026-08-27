import { requirePerm } from "@/lib/guard";
import { getOrg } from "@/lib/org";
import { db, recurringTemplates, contacts, bankAccounts, members } from "@/db";
import { and, eq, desc } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { RecurringManager, type RecurringRow } from "@/components/RecurringManager";
import { computeDocument, type TaxClass } from "@/lib/tax";
import type { DocLineInput } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  await requirePerm("accountant");
  const o = await getOrg();

  const templates = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.orgId, o.id))
    .orderBy(desc(recurringTemplates.createdAt));

  const allContacts = await db
    .select()
    .from(contacts)
    .where(eq(contacts.orgId, o.id));

  const banks = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.orgId, o.id), eq(bankAccounts.archived, false)));

  const staff = await db
    .select()
    .from(members)
    .where(and(eq(members.orgId, o.id), eq(members.active, true)));

  const rows: RecurringRow[] = templates.map((t) => {
    const contact = t.contactId ? allContacts.find((c) => c.id === t.contactId) : null;
    const lines: DocLineInput[] = JSON.parse(t.linesJson);
    const { totalCents } = computeDocument(lines.map((l) => ({
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      taxClass: (l.taxClass || "B16") as TaxClass,
    })), t.taxInclusive);

    return {
      id: t.id,
      name: t.name,
      docType: t.docType,
      contactId: t.contactId,
      contactName: contact?.displayName ?? null,
      assignedMemberId: t.assignedMemberId,
      paidFromBankAccountId: t.paidFromBankAccountId,
      frequency: t.frequency,
      nextRunDate: t.nextRunDate,
      dueInDays: t.dueInDays,
      autoIssue: t.autoIssue,
      active: t.active,
      totalCents,
      lastRunAt: t.lastRunAt,
      lines,
    };
  });

  return (
    <>
      <PageHeader
        title="Recurring Templates"
        subtitle="Automatically generate invoices, bills, or expenses on a schedule"
      />
      <div className="min-h-[70vh]">
        <RecurringManager
          rows={rows}
          customers={allContacts.filter((c) => c.kind === "customer" || c.kind === "both").map((c) => ({ id: c.id, label: c.displayName }))}
          vendors={allContacts.filter((c) => c.kind === "vendor" || c.kind === "both").map((c) => ({ id: c.id, label: c.displayName }))}
          bankAccounts={banks.map((b) => ({ id: b.id, label: b.name }))}
          staff={staff.map((m) => ({ id: m.id, label: m.name || m.email }))}
          dueCount={rows.filter((r) => r.active && r.nextRunDate <= new Date().toISOString().slice(0, 10)).length}
        />
      </div>
    </>
  );
}
