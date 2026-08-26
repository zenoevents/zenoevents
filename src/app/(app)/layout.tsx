import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getUser } from "@/lib/supabase/server";
import { getAccessCached, MODULES } from "@/lib/access";
import { Sidebar } from "@/components/Sidebar";
import { NotificationBell } from "@/components/NotificationBell";
import { GlobalSearch } from "@/components/GlobalSearch";
import { InstallPrompt } from "@/components/InstallPrompt";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { AiAssistantPill } from "@/components/AiAssistantPill";
import { getEntitlements } from "@/lib/billing-server";
import { getDailyBrief } from "@/lib/ai/brief";
import { db, announcements, teamAnnouncements } from "@/db";
import { eq, desc, and } from "drizzle-orm";
import Link from "next/link";
import { TeamAnnouncementBanner } from "@/components/TeamAnnouncementBanner";
import { BlurProvider } from "@/components/BlurContext";
import { BlurToggleSwitch } from "@/components/BlurToggleSwitch";
import { BlurScope } from "@/components/BlurScope";

const roleLabels: Record<string, string> = {
  admin: "Admin",
  accountant: "Accountant",
  sales: "Sales",
  hr: "HR",
  inventory: "Inventory",
  staff: "Staff",
  loading_staff: "Loading Staff",
  warehouse_staff: "Warehouse Staff",
  collection_staff: "Collection Staff",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  const isImpersonating = !!cookieStore.get("impersonated_org_id")?.value;

  if (user.email && !isImpersonating) {
    const { isSuperAdmin } = await import("@/lib/super-admin");
    if (await isSuperAdmin(user.email)) {
      redirect("/admin");
    }
  }

  const access = await getAccessCached();
  // Signed in but neither owner nor staff — needs onboarding
  if (!access || !access.orgRow.name) redirect("/onboarding");

  const ents = await getEntitlements(access.orgRow.id);
  const planBadgeText =
    ents.status === "expired"
      ? `Expired ${ents.subscriptionPlan === "free" ? "Free" : ents.subscriptionPlan === "standard" ? "Standard" : "Business"}`
      : ents.plan === "free"
        ? "Free Plan"
        : ents.plan === "standard"
          ? "Standard Plan"
          : "Business Plan";
  const [announcement, brief, pinnedTeamAnnouncements] = await Promise.all([
    db.select().from(announcements).where(eq(announcements.active, true)).orderBy(desc(announcements.createdAt)).limit(1).then((r) => r[0]),
    getDailyBrief(access).catch(() => null),
    db
      .select({ id: teamAnnouncements.id, title: teamAnnouncements.title, body: teamAnnouncements.body, color: teamAnnouncements.color })
      .from(teamAnnouncements)
      .where(and(eq(teamAnnouncements.orgId, access.orgId), eq(teamAnnouncements.pinned, true)))
      .orderBy(desc(teamAnnouncements.createdAt)),
  ]);

  return (
    <>
      {announcement && (
        <div className={`no-print h-9 flex items-center justify-center px-4 text-center text-[12.5px] font-medium md:relative md:h-auto md:py-2 fixed top-0 inset-x-0 z-50 md:static ${
          announcement.tone === "warn" ? "bg-amber-100 text-amber-900" : "bg-[var(--color-accent-500)] text-white"
        }`}>
          <span className="truncate">{announcement.message}</span>
        </div>
      )}
      <TeamAnnouncementBanner announcements={pinnedTeamAnnouncements} />
      {isImpersonating && <ImpersonationBanner orgName={access.orgRow.name} />}
      <div className="flex min-h-screen" style={access.orgRow.brandColor ? { "--color-brand": access.orgRow.brandColor } as React.CSSProperties : undefined}>
        <InstallPrompt />
        <Sidebar
          orgName={access.orgRow.name}
          orgEmail={user.email}
          logoUrl={access.orgRow.logoUrl}
          perms={MODULES.map((m) => m.key).filter((k) => access.perms.has(k))}
          roleLabel={access.isOwner ? "Owner" : roleLabels[access.role]}
          isAdmin={access.isOwner || access.role === "admin"}
          timeTrackingEnabled={access.orgRow.timeTrackingEnabled}
          topOffsetClass={announcement ? "top-9" : "top-0"}
        />
        <BlurProvider>
        <main className="flex-1 min-w-0 flex flex-col h-screen overflow-y-auto">
          {announcement && <div className="h-9 md:hidden shrink-0 no-print" />}
          <div className="h-[76px] md:hidden shrink-0 no-print" />
          <div className="sticky top-[76px] md:top-0 z-30 bg-white/80 backdrop-blur-md border-b border-[var(--color-ink-100)] px-4 py-3 md:py-0 md:px-8 md:h-14 flex items-center justify-between no-print gap-4">
            <div className="flex-1 hidden md:flex items-center gap-3 max-w-[150px]">
              <Link
                href="/settings/billing"
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                  ents.status === "expired"
                    ? "bg-red-50 text-red-700 hover:bg-red-100"
                    : "bg-[var(--color-brand)]/10 text-[var(--color-brand)] hover:bg-[var(--color-brand)]/20"
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ents.status === "expired" ? "M12 8v4m0 4h.01M10.29 3.86l-7.12 12.3A2 2 0 004.88 19h14.24a2 2 0 001.71-2.84l-7.12-12.3a2 2 0 00-3.42 0z" : "M5 13l4 4L19 7"} /></svg>
                {planBadgeText}
              </Link>
            </div>
            <div className="flex-1 flex items-center gap-2 max-w-md mx-auto md:hidden">
              <div className="flex-1 min-w-0">
                <GlobalSearch />
              </div>
              <BlurToggleSwitch />
              <NotificationBell orgId={access.orgId} memberId={access.memberId} variant="inline" />
            </div>
            <div className="hidden md:block flex-1 max-w-md mx-auto">
              <GlobalSearch />
            </div>
            <div className="flex-1 hidden md:flex items-center justify-end gap-3 max-w-[240px]">
              <BlurToggleSwitch withLabel />
              <NotificationBell orgId={access.orgId} memberId={access.memberId} variant="inline" />
            </div>
          </div>
          <div className="px-4 py-6 md:px-8 md:py-7 max-w-[1200px] w-full mx-auto flex-1 flex flex-col">
            <BlurScope>{children}</BlurScope>
          </div>
        </main>
        </BlurProvider>
      </div>
      <AiAssistantPill initialBriefCount={brief?.count ?? 0} brandColor={access.orgRow.brandColor} />
    </>
  );
}
