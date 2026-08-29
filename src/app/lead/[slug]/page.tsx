import { getOrgByLeadFormSlug } from "@/lib/leads";
import { LeadForm } from "./LeadForm";
import { PastEvents } from "./PastEvents";

export const dynamic = "force-dynamic";

export default async function PublicLeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ channel?: string; campaign?: string; ref?: string }>;
}) {
  const { slug } = await params;
  const { channel, campaign, ref } = await searchParams;
  const org = await getOrgByLeadFormSlug(slug);

  if (!org) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] px-4">
        <div className="text-center">
          <div className="text-4xl mb-3">📋</div>
          <h1 className="text-lg font-semibold mb-1">Form not available</h1>
          <p className="text-sm text-gray-500">This link is invalid or no longer active.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] px-4 py-10">
      <LeadForm
        slug={slug}
        orgName={org.name}
        logoUrl={org.logoUrl}
        brandColor={org.brandColor}
        channel={channel === "referral" ? "referral" : channel || "website"}
        campaign={campaign || null}
        ref_={ref || null}
      />
      <PastEvents urls={(org.instagramPostUrls as string[] | null) ?? []} />
      <div className="text-center text-[11px] text-gray-400 mt-4">
        Powered by Zeno · <a href="/privacy" className="hover:text-gray-600">Privacy</a> · <a href="/terms" className="hover:text-gray-600">Terms</a>
      </div>
    </div>
  );
}
