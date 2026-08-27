import { DocumentEditor } from "@/components/DocumentEditor";
import { requirePerm } from "@/lib/guard";
import { editorOptions, fetchInitialData } from "@/components/docData";
import { PageHeader } from "@/components/ui";
import { getEntitlements, getInvoiceUsage } from "@/lib/billing-server";
import { getOrg } from "@/lib/org";
import { UpgradePrompt } from "@/components/UpgradePrompt";

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

  const orgRow = await getOrg();
  const ents = await getEntitlements(orgRow.id);
  const usage = await getInvoiceUsage(orgRow.id);
  const limit = ents.limits.invoices;
  const isLocked = limit !== -1 && usage >= limit;

  return (
    <UpgradePrompt 
      isLocked={isLocked} 
      featureName="More Invoices" 
      description={`You've reached your monthly limit of ${limit} invoices on the ${ents.limits.name} plan. Upgrade to issue unlimited invoices.`}
    >
      <PageHeader title="New invoice" subtitle="VAT is calculated per line, the KRA way" />
      <DocumentEditor
        type="invoice"
        customDocumentColumnName={opts.customDocumentColumnName}
        members={opts.members}
        contacts={opts.contacts}
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
    </UpgradePrompt>
  );
}
