import { DocumentEditor } from "@/components/DocumentEditor";
import { requirePerm } from "@/lib/guard";
import { editorOptions } from "@/components/docData";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  await requirePerm("expenses");
  const { project } = await searchParams;
  const defaultProjectId = project ? Number(project) : null;
  const opts = await editorOptions("purchase");
  return (
    <>
      <PageHeader title="New expense" subtitle="Paid immediately from bank, M-Pesa or cash" />
      <DocumentEditor
        type="expense"
        customDocumentColumnName={opts.customDocumentColumnName}
        members={opts.members}
        contacts={opts.contacts}
        customers={opts.customers}
        items={[]}
        costCenters={opts.costCenters}
        warehouses={opts.warehouses}
        itemWarehouses={opts.itemWarehouses}
        expenseAccounts={opts.expenseAccounts}
        bankAccounts={opts.bankAccounts}
        vendorPayouts={opts.vendorPayouts}
        projects={opts.projects}
        defaultProjectId={defaultProjectId}
        backHref="/purchases/expenses"
        detailHref="/purchases/expenses"
      />
    </>
  );
}
