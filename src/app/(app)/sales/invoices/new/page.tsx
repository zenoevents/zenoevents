import { DocumentEditor } from "@/components/DocumentEditor";
import { requirePerm } from "@/lib/guard";
import { editorOptions, fetchInitialData } from "@/components/docData";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string; templateId?: string; project?: string }>;
}) {
  await requirePerm("invoices");
  const { contact, templateId, project } = await searchParams;
  const defaultContactId = contact ? Number(contact) : null;
  const defaultProjectId = project ? Number(project) : null;
  const opts = await editorOptions("sale");

  let initialData = undefined;
  if (templateId) {
    try {
      const data = await fetchInitialData(Number(templateId));
      initialData = { ...data, id: undefined, isTemplate: undefined }; // clear ID and isTemplate so it saves as a new normal document
    } catch (err) {}
  }

  return (
    <>
      <PageHeader title="New invoice" subtitle="VAT is calculated per line, the KRA way" />
      <DocumentEditor
        type="invoice"
        customDocumentColumnName={opts.customDocumentColumnName}
        members={opts.members}
        contacts={opts.contacts}
        customerGroups={opts.customerGroups}
        customerGroupsRequired={opts.customerGroupsRequired}
        items={opts.items}
        costCenters={opts.costCenters}
        warehouses={opts.warehouses}
        defaultContactId={defaultContactId}
        projects={opts.projects}
        defaultProjectId={defaultProjectId}
        initialData={initialData as any}
        backHref="/sales/invoices"
        detailHref="/sales/invoices"
      />
    </>
  );
}
