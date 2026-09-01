import { DocumentEditor } from "@/components/DocumentEditor";
import { requirePerm } from "@/lib/guard";
import { editorOptions } from "@/components/docData";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  await requirePerm("purchase_orders");
  const opts = await editorOptions("purchase");
  return (
    <>
      <PageHeader title="New purchase order" subtitle="No accounting effect until converted to a bill" />
      <DocumentEditor
        type="purchase_order"
        customDocumentColumnName={opts.customDocumentColumnName}
        members={opts.members}
        contacts={opts.contacts}
        items={opts.items}
        itemGroups={opts.itemGroups}
        itemGroupsRequired={opts.itemGroupsRequired}
        costCenters={opts.costCenters}
        warehouses={opts.warehouses}
        itemWarehouses={opts.itemWarehouses}
        expenseAccounts={opts.expenseAccounts}
        vendorPayouts={opts.vendorPayouts}
        backHref="/purchases/orders"
        detailHref="/purchases/orders"
      />
    </>
  );
}
