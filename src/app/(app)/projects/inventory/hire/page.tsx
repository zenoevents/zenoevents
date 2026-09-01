import { requirePerm } from "@/lib/guard";
import { listHireContracts, listHireableInventory } from "@/lib/hire-contracts";
import { PageHeader, PrimaryLink } from "@/components/ui";
import { HireContractsClient } from "./HireContractsClient";

export const dynamic = "force-dynamic";

export default async function HireOutPage() {
  await requirePerm("projects");
  const [contracts, hireableItems] = await Promise.all([listHireContracts(), listHireableInventory()]);

  return (
    <>
      <PageHeader
        title="Hire Out"
        subtitle="Your own gear, rented to other event companies — separate from internal project reservations."
        action={<PrimaryLink href="/projects/inventory">← Event Inventory</PrimaryLink>}
      />
      <HireContractsClient contracts={contracts} hireableItems={hireableItems} />
    </>
  );
}
