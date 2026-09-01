import { requirePerm } from "@/lib/guard";
import { listContractTypes, listContractTemplates } from "@/lib/contract-templates";
import { PageHeader } from "@/components/ui";
import { ContractTypesPanel, ContractTemplatesPanel } from "@/components/ContractTemplatesManager";

export const dynamic = "force-dynamic";

export default async function ContractTemplatesPage() {
  await requirePerm("contracts");
  const [types, templates] = await Promise.all([listContractTypes(), listContractTemplates()]);

  return (
    <>
      <PageHeader title="Contract Types & Templates" subtitle="Paste your own contract wording once per type — picked and auto-filled when starting a new project contract." />
      <ContractTypesPanel types={types} />
      <ContractTemplatesPanel types={types} templates={templates} />
    </>
  );
}
