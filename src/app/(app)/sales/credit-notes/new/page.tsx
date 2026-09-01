import { DocumentEditor } from "@/components/DocumentEditor";
import { requirePerm } from "@/lib/guard";
import { editorOptions } from "@/components/docData";
import { PageHeader } from "@/components/ui";
import { db, documents } from "@/db";
import { and, eq } from "drizzle-orm";
import { getOrg } from "@/lib/org";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewCreditNotePage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string; invoice?: string }>;
}) {
  await requirePerm("credit_notes");
  const { contact, invoice } = await searchParams;
  let defaultContactId = contact ? Number(contact) : null;
  const sourceInvoiceId = invoice ? Number(invoice) : undefined;
  let defaultNotes: string | undefined;

  // Coming from an invoice's "Partial credit note" link — pull its customer
  // and reference so staff don't have to re-pick the customer, but leave the
  // lines/amount entirely blank for them to fill in (unlike "Full credit
  // note", which copies every line at full amount via a separate action).
  if (sourceInvoiceId) {
    const o = await getOrg();
    const [inv] = await db
      .select({ id: documents.id, number: documents.number, contactId: documents.contactId, type: documents.type })
      .from(documents)
      .where(and(eq(documents.orgId, o.id), eq(documents.id, sourceInvoiceId)))
      .limit(1);
    if (!inv || inv.type !== "invoice") notFound();
    defaultContactId = inv.contactId;
    defaultNotes = `Credit note for invoice ${inv.number}`;
  }

  const opts = await editorOptions("sale");
  return (
    <>
      <PageHeader title="New credit note" subtitle="Reverses revenue and output VAT for the lines below" />
      <DocumentEditor
        type="credit_note"
        customDocumentColumnName={opts.customDocumentColumnName}
        members={opts.members}
        contacts={opts.contacts}
        customerGroups={opts.customerGroups}
        customerGroupsRequired={opts.customerGroupsRequired}
        items={opts.items}
        costCenters={opts.costCenters}
        warehouses={opts.warehouses}
        itemWarehouses={opts.itemWarehouses}
        defaultContactId={defaultContactId}
        sourceInvoiceId={sourceInvoiceId}
        defaultNotes={defaultNotes}
        backHref="/sales/credit-notes"
        detailHref="/sales/credit-notes"
      />
    </>
  );
}
