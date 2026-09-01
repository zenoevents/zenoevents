"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "dashboard", label: "Overview" },
  { href: "projects", label: "Projects" },
  { href: "documents", label: "Invoices & Quotes" },
  { href: "knowledge", label: "Help & Articles" },
  { href: "profile", label: "Profile" },
];

const CRUMB: Record<string, string> = {
  projects: "Projects",
  dashboard: "Dashboard",
  documents: "Invoices & Quotes",
  knowledge: "Help & Articles",
  profile: "Profile",
};

export function PortalBreadcrumb({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname();
  const seg = pathname.split("/").filter(Boolean)[2] ?? "projects";
  const label = CRUMB[seg] ?? "Projects";
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-[var(--color-ink-400)]">
      <Link href={`/portal/${orgSlug}/projects`} className="hover:text-[var(--color-ink-600)]">Home</Link>
      <span>/</span>
      <span className="text-[var(--color-ink-600)] font-medium">{label}</span>
    </div>
  );
}

export function PortalNav({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto min-w-0 bg-[var(--color-ink-50)] rounded-full p-1">
      {ITEMS.map((item) => {
        const href = `/portal/${orgSlug}/${item.href}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={item.href}
            href={href}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-[13.5px] font-medium whitespace-nowrap transition-colors ${
              active
                ? "bg-white text-[var(--color-ink-900)] shadow-sm"
                : "text-[var(--color-ink-600)] hover:text-[var(--color-ink-900)]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
