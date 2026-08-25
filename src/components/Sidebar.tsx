"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";
import { CreateMenu } from "./CreateMenu";

const groups: {
  label: string | null;
  items: { href: string; label: string; icon: string; perm: string }[];
}[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Home", icon: "🏠", perm: "dashboard" },
      { href: "/announcements", label: "Announcements", icon: "📣", perm: "announcements" },
      { href: "/time-tracking", label: "Time Tracking", icon: "⏱️", perm: "dashboard" },
      { href: "/leave-requests", label: "Leave Requests", icon: "🌴", perm: "leave_requests" },
    ],
  },
  {
    label: "Projects",
    items: [
      { href: "/projects", label: "Projects", icon: "🎪", perm: "projects" },
    ],
  },
  {
    label: "Selling",
    items: [
      { href: "/contacts", label: "Customers & Vendors", icon: "👥", perm: "contacts" },
      { href: "/pipeline", label: "Deals", icon: "🎯", perm: "pipeline" },
      { href: "/sales/quotes", label: "Quotes", icon: "📝", perm: "quotes" },
      { href: "/sales/quote-templates", label: "Quote Templates", icon: "🗒️", perm: "quote_templates" },
      { href: "/sales/invoices", label: "Invoices", icon: "🧾", perm: "invoices" },
      { href: "/sales/invoice-templates", label: "Invoice Templates", icon: "🗂️", perm: "invoice_templates" },
      { href: "/sales/payments", label: "Payments Received", icon: "💰", perm: "invoices" },
      { href: "/sales/credit-notes", label: "Credit Notes", icon: "↩️", perm: "credit_notes" },
    ],
  },
  {
    label: "Spending",
    items: [
      { href: "/purchases/expenses", label: "Expenses", icon: "💸", perm: "expenses" },
      { href: "/expense-claims", label: "Expense Claims", icon: "🧾", perm: "expense_claims" },
      { href: "/purchases/bills", label: "Bills", icon: "📄", perm: "bills" },
      { href: "/purchases/orders", label: "Purchase Orders", icon: "📦", perm: "purchase_orders" },
      { href: "/purchases/payment-runs", label: "Payment Runs", icon: "🏃", perm: "bills" },
      { href: "/purchases/payouts", label: "Stuck Payouts", icon: "⚠️", perm: "can_payout" },
      { href: "/items", label: "Items & Stock", icon: "📦", perm: "items" },
      { href: "/items/warehouses", label: "Warehouses", icon: "🏬", perm: "items" },
      { href: "/items/transfers", label: "Stock Transfers", icon: "🔄", perm: "items" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/banking", label: "Bank & M-Pesa", icon: "🏦", perm: "banking" },
      { href: "/accountant", label: "Accountant", icon: "📚", perm: "accountant" },
      { href: "/accounting/assets", label: "Fixed Assets", icon: "🏢", perm: "fixed_assets" },
      { href: "/analytics", label: "Analytics", icon: "📊", perm: "reports" },
      { href: "/reports", label: "Reports", icon: "📈", perm: "reports" },
    ],
  },
  {
    label: "Payroll",
    items: [
      { href: "/payroll/runs", label: "Payroll Runs", icon: "💵", perm: "payroll" },
      { href: "/payroll/employees", label: "Employees", icon: "🧑‍💼", perm: "payroll" },
      { href: "/payroll/rules", label: "Rules & Tax", icon: "⚖️", perm: "payroll" },
      { href: "/payroll/loans", label: "Loans & Deductions", icon: "🏷️", perm: "payroll" },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/staff", label: "Staff & Roles", icon: "🛡️", perm: "staff" },
      { href: "/recurring", label: "Recurring Templates", icon: "🔁", perm: "accountant" },
      { href: "/settings/audit-logs", label: "Audit Logs", icon: "🕵️", perm: "__admin_only" },
      { href: "/settings", label: "Settings", icon: "⚙️", perm: "settings" },
    ],
  },
];

interface SidebarProps {
  orgName?: string;
  orgEmail?: string;
  logoUrl?: string | null;
  /** module keys the current user may see; undefined = show all */
  perms?: string[];
  roleLabel?: string;
  timeTrackingEnabled?: boolean;
  /** Strictly owner/admin — audit logs are never role-toggleable, unlike every other module. */
  isAdmin?: boolean;
  /** Tailwind top-offset class for the mobile fixed bar, e.g. "top-9" when an announcement banner is showing above it. */
  topOffsetClass?: string;
}

export function Sidebar({ orgName, orgEmail, logoUrl, perms, roleLabel, timeTrackingEnabled, isAdmin, topOffsetClass = "top-0" }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on navigation
  useEffect(() => setOpen(false), [pathname]);

  const allowed = perms ? new Set(perms) : null;
  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        if (it.href === "/time-tracking" && !timeTrackingEnabled) return false;
        if (it.perm === "__admin_only") return !!isAdmin;
        return !allowed || allowed.has(it.perm);
      }),
    }))
    .filter((g) => g.items.length > 0);

  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const displayName = orgName || "My Business";
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const nav = (
    <>
      {/* Business identity header */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`shrink-0 w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center ${
              logoUrl ? "" : "bg-[var(--color-accent-500)] shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
            }`}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={displayName} width={56} height={56} className="object-contain w-full h-full" />
            ) : (
              <span className="text-white text-[18px] font-bold">{initials}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold tracking-tight truncate leading-tight">{displayName}</div>
            <div className="text-[10.5px] text-[var(--color-ink-400)] mt-0.5">
              {roleLabel ? `${roleLabel} · ` : ""}Powered by Zeno
            </div>
          </div>
        </div>
      </div>

      {(!allowed || allowed.has("invoices")) && (
        <div className="px-3 pb-3">
          <CreateMenu />
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {visibleGroups.map((g, gi) => (
          <div key={gi}>
            {g.label && (
              <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)]">
                {g.label}
              </div>
            )}
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[13px] transition-colors ${
                      active(it.href)
                        ? "bg-white/80 text-[var(--color-accent-700)] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                        : "text-[var(--color-ink-600)] hover:bg-white/50"
                    }`}
                  >
                    <span className="w-4 text-center opacity-70">{it.icon}</span>
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="hairline-t px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[11.5px] text-[var(--color-ink-600)] truncate">{orgEmail || ""}</div>
        </div>
        <SignOutButton />
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar — floating pill: hamburger left, org name + role centered */}
      <div className={`md:hidden no-print fixed ${topOffsetClass} inset-x-0 z-40 px-3 pt-3`}>
        <div className="relative sidebar-chrome rounded-[32px] shadow-[0_2px_14px_rgba(0,0,0,0.08)] border border-[var(--color-ink-100)]/70 h-16 flex items-center justify-center">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="absolute left-2.5 w-10 h-10 flex flex-col items-center justify-center gap-[5px] rounded-full hover:bg-white/60"
          >
            <span className="block w-5 h-[1.5px] bg-[var(--color-ink-900)]" />
            <span className="block w-5 h-[1.5px] bg-[var(--color-ink-900)]" />
            <span className="block w-5 h-[1.5px] bg-[var(--color-ink-900)]" />
          </button>
          <div className="flex flex-col items-center leading-tight max-w-[55vw]">
            <span className="text-[14px] font-semibold tracking-tight truncate">{displayName}</span>
            {roleLabel && <span className="text-[11px] text-[var(--color-ink-400)] mt-0.5 truncate">{roleLabel}</span>}
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden no-print fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[270px] max-w-[85vw] bg-[var(--color-ink-50)] flex flex-col shadow-xl">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute top-4 right-3 w-8 h-8 rounded-full hover:bg-white/70 text-[18px] text-[var(--color-ink-600)]"
            >
              ×
            </button>
            {nav}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex sidebar-chrome no-print w-[230px] shrink-0 sticky top-0 h-screen flex-col border-r border-[var(--color-ink-100)]">
        {nav}
      </aside>
    </>
  );
}
