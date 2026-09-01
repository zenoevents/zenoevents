import { getClientSession } from "@/lib/client-portal/auth";
import { db, documents, payments } from "@/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ClientDocuments } from "./ClientDocuments";
import { DocumentsSummary } from "./DocumentsSummary";
import { StatementTab } from "@/components/StatementTab";

export const dynamic = "force-dynamic";

export default async function ClientPortalDocuments({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgSlug } = await params;
  const { tab = "invoices" } = await searchParams;
  const session = await getClientSession(orgSlug);
  if (!session) redirect(`/portal/${orgSlug}/login`);

  const allDocs = await db.select()
    .from(documents)
    .where(
      and(
        eq(documents.orgId, session.orgId),
        eq(documents.contactId, session.contactId),
        inArray(documents.type, ["invoice", "quote", "credit_note"])
      )
    )
    .orderBy(desc(documents.date), desc(documents.id));

  const allPayments = await db.select()
    .from(payments)
    .where(
      and(
        eq(payments.orgId, session.orgId),
        eq(payments.contactId, session.contactId)
      )
    );

  const viewDocs = allDocs.filter(d => tab === "quotes" ? d.type === "quote" : tab === "invoices" ? d.type === "invoice" : false);

  return (
    <>
      <PageHeader 
        title="Documents & Statements" 
        subtitle="View your invoices, quotes, and download statements."
      />

      <div className="flex gap-4 border-b border-[var(--color-ink-200)] mb-6">
        <a href={`/portal/${orgSlug}/documents?tab=invoices`} className={`pb-3 text-[14px] font-medium transition-colors ${tab === "invoices" ? "text-[var(--color-brand)] border-b-2 border-[var(--color-brand)]" : "text-[var(--color-ink-500)] hover:text-[var(--color-ink-900)]"}`}>
          Invoices
        </a>
        <a href={`/portal/${orgSlug}/documents?tab=quotes`} className={`pb-3 text-[14px] font-medium transition-colors ${tab === "quotes" ? "text-[var(--color-brand)] border-b-2 border-[var(--color-brand)]" : "text-[var(--color-ink-500)] hover:text-[var(--color-ink-900)]"}`}>
          Quotes
        </a>
        <a href={`/portal/${orgSlug}/documents?tab=receipts`} className={`pb-3 text-[14px] font-medium transition-colors ${tab === "receipts" ? "text-[var(--color-brand)] border-b-2 border-[var(--color-brand)]" : "text-[var(--color-ink-500)] hover:text-[var(--color-ink-900)]"}`}>
          Receipts
        </a>
        <a href={`/portal/${orgSlug}/documents?tab=statement`} className={`pb-3 text-[14px] font-medium transition-colors ${tab === "statement" ? "text-[var(--color-brand)] border-b-2 border-[var(--color-brand)]" : "text-[var(--color-ink-500)] hover:text-[var(--color-ink-900)]"}`}>
          Statement of Account
        </a>
      </div>

      <div className="max-w-5xl">
        {tab === "statement" ? (
          <StatementTab contact={{ id: session.contactId, displayName: "You" } as any} docs={allDocs} pays={allPayments} portalSlug={orgSlug} />
        ) : (
          <>
            {(tab === "invoices" || tab === "quotes") && (
              <DocumentsSummary type={tab === "quotes" ? "quote" : "invoice"} docs={viewDocs} />
            )}
            <ClientDocuments slug={orgSlug} tab={tab} documents={viewDocs} payments={allPayments} />
          </>
        )}
      </div>
    </>
  );
}
