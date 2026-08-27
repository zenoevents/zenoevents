"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { fmtKES } from "@/lib/money";

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}

const tooltipStyle = {
  borderRadius: "8px",
  border: "none",
  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
  fontSize: "12.5px",
  padding: "8px 12px",
};

const axisTick = { fontSize: 11.5, fill: "#86868b" };

/** Monthly org signups — brand-teal area with subtle gradient. */
export function SignupsChart({ data }: { data: { label: string; signups: number }[] }) {
  const mounted = useMounted();
  if (!mounted) return <div className="h-56 w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f766e" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ed" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={axisTick} allowDecimals={false} width={40} />
          <Tooltip cursor={{ stroke: "#d2d2d7" }} contentStyle={tooltipStyle} formatter={(v: any) => [v, "Signups"]} />
          <Area type="monotone" dataKey="signups" stroke="#0f766e" strokeWidth={2} fill="url(#signupFill)" dot={{ r: 3, fill: "#0f766e", strokeWidth: 0 }} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const PLAN_COLORS: Record<string, string> = {
  business: "#0f766e",
  standard: "#5eead4",
  free: "#d2d2d7",
  active: "#0f766e",
  locked: "#d2d2d7",
};

/** Plan mix donut with centered total. */
export function PlanDonut({ data }: { data: { plan: string; label: string; count: number }[] }) {
  const mounted = useMounted();
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-44 w-44 shrink-0">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="count" nameKey="label" innerRadius={56} outerRadius={80} paddingAngle={2} strokeWidth={0}>
                {data.map((d) => (
                  <Cell key={d.plan} fill={PLAN_COLORS[d.plan] || "#e8e8ed"} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => [`${v} org${v === 1 ? "" : "s"}`, name]} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-44 w-44 rounded-full bg-[var(--color-ink-50)]/40 animate-pulse" />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[22px] font-semibold tnum leading-none">{total}</div>
          <div className="text-[10.5px] text-[var(--color-ink-400)] mt-1">orgs</div>
        </div>
      </div>
      <ul className="space-y-2.5 text-[12.5px] min-w-0">
        {data.map((d) => (
          <li key={d.plan} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: PLAN_COLORS[d.plan] || "#e8e8ed" }} />
            <span className="text-[var(--color-ink-600)]">{d.label}</span>
            <span className="ml-auto pl-3 font-medium tnum">{d.count}</span>
            <span className="text-[var(--color-ink-400)] tnum w-9 text-right">{total ? Math.round((d.count / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Monthly M-Pesa volume bars; failed events shown as a thin red series. */
export function MpesaVolumeChart({ data }: { data: { label: string; volumeCents: number; failed: number }[] }) {
  const mounted = useMounted();
  const formatted = data.map((d) => ({ ...d, Volume: d.volumeCents / 100 }));

  if (!mounted) return <div className="h-56 w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ed" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={axisTick} width={52} tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
          <Tooltip
            cursor={{ fill: "#f5f5f7" }}
            contentStyle={tooltipStyle}
            formatter={(v: any, name: any) => (name === "Volume" ? [fmtKES(Number(v) * 100), "Volume"] : [v, "Failed events"])}
          />
          <Bar dataKey="Volume" fill="#0f766e" radius={[4, 4, 0, 0]} maxBarSize={36} />
          <Bar dataKey="failed" fill="#c0392b" radius={[4, 4, 0, 0]} maxBarSize={10} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
