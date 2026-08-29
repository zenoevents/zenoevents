import { requirePerm } from "@/lib/guard";
import { listLeadChannels, buildLeadFormUrl } from "@/lib/leads";
import { getOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { LeadChannelsClient } from "./LeadChannelsClient";
import { PastEventsClient } from "./PastEventsClient";

export const dynamic = "force-dynamic";

export default async function LeadChannelsPage() {
  await requirePerm("leads");
  const [channels, o] = await Promise.all([listLeadChannels(), getOrg()]);
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
      <div className="mt-4">
        <PastEventsClient initialUrls={(o.instagramPostUrls as string[] | null) ?? []} />
      </div>
    </>
  );
}
