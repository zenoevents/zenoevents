import { DocumentEditor } from "@/components/DocumentEditor";
import { requirePerm } from "@/lib/guard";
import { editorOptions } from "@/components/docData";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>;
}) {
  await requirePerm("bills");
  const { contact } = await searchParams;
  const defaultContactId = contact ? Number(contact) : null;
  const opts = await editorOptions("purchase");
  return (
    <>
      <PageHeader title="New bill" subtitle="Buying stock items adds them to inventory at FIFO cost" />
      <DocumentEditor
        type="bill"
        customDocumentColumnName={opts.customDocumentColumnName}
        members={opts.members}
        contacts={opts.contacts}
        customers={opts.customers}
        items={opts.items}
        itemGroups={opts.itemGroups}
        itemGroupsRequired={opts.itemGroupsRequired}
        costCenters={opts.costCenters}
        warehouses={opts.warehouses}
        itemWarehouses={opts.itemWarehouses}
        expenseAccounts={opts.expenseAccounts}
        vendorPayouts={opts.vendorPayouts}
        defaultContactId={defaultContactId}
        backHref="/purchases/bills"
        detailHref="/purchases/bills"
      />
    </>
  );
}
