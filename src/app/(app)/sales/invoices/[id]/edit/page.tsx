import { DocumentEditor } from "@/components/DocumentEditor";
import { requirePerm } from "@/lib/guard";
import { editorOptions, fetchInitialData } from "@/components/docData";
import { PageHeader } from "@/components/ui";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePerm("invoices");
  const { id } = await params;
  const docId = Number(id);
  if (isNaN(docId)) notFound();

  const opts = await editorOptions("sale");
  let initialData;
  try {
    initialData = await fetchInitialData(docId);
  } catch (err) {
    console.error("fetchInitialData failed for invoices edit:", err);
    notFound();
  }

  return (
    <>
      <PageHeader title={`Edit Invoice`} />
      <DocumentEditor
        type="invoice"
        customDocumentColumnName={opts.customDocumentColumnName}
        members={opts.members}
        contacts={opts.contacts}
        items={opts.items}
        costCenters={opts.costCenters}
        warehouses={opts.warehouses}
        projects={opts.projects}
        backHref={`/sales/invoices/${docId}`}
        detailHref="/sales/invoices"
        initialData={initialData as any}
      />
    </>
  );
}
