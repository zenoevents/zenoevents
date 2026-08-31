import { getClientSession } from "@/lib/client-portal/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/portal";
import { logoutAction } from "./logout-action";
import { PortalNav, PortalBreadcrumb } from "./PortalNav";

export const dynamic = "force-dynamic";

export default async function ClientPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await getClientSession(orgSlug);

  if (!session) {
    redirect(`/portal/${orgSlug}/login`);
  }

  const o = session.org;
  const logout = logoutAction.bind(null, orgSlug);

  return (
    <div
      className="min-h-screen bg-[#F1F2F6] font-sans text-[var(--color-ink-900)] flex flex-col"
      style={{ "--color-brand": o.brandColor || "#0f766e", "--radius-card": "20px" } as React.CSSProperties}
    >
      {/* Full-width bar: logo, segmented pill nav, account/logout. Bigger radius
          + bolder wordmark than the main app chrome — portal-only reskin, does
          not touch the shared design tokens used elsewhere. */}
      <header className="sticky top-0 z-40 px-4 pt-4">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white hairline shadow-[var(--shadow-card)] rounded-3xl px-5 py-3 flex items-center gap-5">
            <Link
              href={`/portal/${orgSlug}/projects`}
              className="shrink-0 font-bold text-[15px] tracking-tight whitespace-nowrap"
            >
              {o.name}
            </Link>
            <PortalNav orgSlug={orgSlug} />
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <div className="w-9 h-9 rounded-full bg-[var(--color-accent-100)] text-[var(--color-accent-700)] text-[13px] font-bold flex items-center justify-center">
                {o.name.slice(0, 1).toUpperCase()}
              </div>
              <form action={logout}>
                <button
                  type="submit"
                  className="flex items-center justify-center w-9 h-9 rounded-full text-[var(--color-ink-400)] hover:text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] transition-colors"
                  title="Log out"
                  aria-label="Log out"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto p-6 md:p-8">
        <div className="mb-5">
          <PortalBreadcrumb orgSlug={orgSlug} />
        </div>
        {children}
      </main>
    </div>
  );
}
