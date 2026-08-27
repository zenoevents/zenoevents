import { DocumentEditor } from "@/components/DocumentEditor";
import { requirePerm } from "@/lib/guard";
import { editorOptions, fetchInitialData } from "@/components/docData";
import { PageHeader } from "@/components/ui";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EditQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePerm("quotes");
  const { id } = await params;
  const docId = Number(id);
  if (isNaN(docId)) notFound();

  const opts = await editorOptions("sale");
  let initialData;
  try {
    initialData = await fetchInitialData(docId);
  } catch (err) {
    console.error("fetchInitialData failed for quotes edit:", err);
    notFound();
  }

  return (
    <>
      <PageHeader title={`Edit Quote`} />
      <DocumentEditor
        type="quote"
        customDocumentColumnName={opts.customDocumentColumnName}
        members={opts.members}
        contacts={opts.contacts}
        items={opts.items}
        costCenters={opts.costCenters}
        warehouses={opts.warehouses}
        projects={opts.projects}
        backHref={`/sales/quotes/${docId}`}
        detailHref="/sales/quotes"
        initialData={initialData as any}
      />
    </>
  );
}
