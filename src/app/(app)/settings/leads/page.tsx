import { requirePerm } from "@/lib/guard";
import { listLeadChannels, buildLeadFormUrl } from "@/lib/leads";
import { PageHeader } from "@/components/ui";
import { LeadChannelsClient } from "./LeadChannelsClient";

export const dynamic = "force-dynamic";

export default async function LeadChannelsPage() {
  await requirePerm("leads");
  const channels = await listLeadChannels();
  const anyEnabled = channels.some((c) => c.enabled);
  const websiteUrl = anyEnabled ? await buildLeadFormUrl("website") : null;
  const instagramUrl = anyEnabled ? await buildLeadFormUrl("instagram") : null;
  const facebookUrl = anyEnabled ? await buildLeadFormUrl("facebook") : null;

  return (
    <>
      <PageHeader title="Lead Capture Channels" subtitle="Every channel hands off to one shared, branded form — toggle on what you use." />
      <LeadChannelsClient
        channels={channels}
        websiteUrl={websiteUrl}
        instagramUrl={instagramUrl}
        facebookUrl={facebookUrl}
      />
    </>
  );
}
