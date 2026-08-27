"use client";

import { useEffect, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadialBarChart, RadialBar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, ZAxis, Sankey, FunnelChart, Funnel, LabelList,
} from "recharts";
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
const axisTick = { fontSize: 11, fill: "#86868b" };
const kesTick = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 100_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v / 100_000).toFixed(0)}k` : String(v / 100));

/** Money trend: one or two series (e.g. this year vs last year, gross vs net). */
export function TrendAreaChart({
  data,
  series,
  height = 220,
  money = true,
}: {
  data: Record<string, any>[];
  series: { key: string; label: string; color: string; dashed?: boolean }[];
  height?: number;
  money?: boolean;
}) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ed" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={axisTick} width={44} tickFormatter={money ? kesTick : undefined} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: any, name: any) => [money ? fmtKES(Number(v)) : v, name]}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} iconType="circle" />}
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              fill={`url(#grad-${s.key})`}
              dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Two-line comparison (e.g. gross vs net margin %) — no fill, just lines. */
export function TrendLineChart({
  data,
  series,
  height = 220,
  suffix = "",
}: {
  data: Record<string, any>[];
  series: { key: string; label: string; color: string }[];
  height?: number;
  suffix?: string;
}) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ed" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={axisTick} width={40} tickFormatter={(v) => `${v}${suffix}`} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => [`${v}${suffix}`, name]} />
          <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} iconType="circle" />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal ranking bars (top customers/items/vendors, etc). */
export function RankBarChart({
  data,
  color = "var(--color-brand, #0f766e)",
  height,
  money = true,
}: {
  data: { name: string; value: number }[];
  color?: string;
  height?: number;
  money?: boolean;
}) {
  const mounted = useMounted();
  const h = height ?? Math.max(160, data.length * 36);
  if (!mounted) return <div style={{ height: h }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  const maxChars = Math.max(0, ...data.map((d) => (d.name || "").length));
  const yAxisWidth = Math.min(180, Math.max(110, maxChars * 7));

  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e8e8ed" />
          <XAxis type="number" axisLine={false} tickLine={false} tick={axisTick} tickFormatter={money ? kesTick : undefined} />
          <YAxis
            type="category"
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11.5, fill: "#515154" }}
            width={yAxisWidth}
            tickFormatter={(t) => (t && t.length > 22 ? t.slice(0, 20) + "…" : t)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: any, name: any, item: any) => [
              money ? fmtKES(Number(v)) : v,
              item?.payload?.name || "",
            ]}
          />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Categorical vertical bars (aging buckets, pipeline stages, hires per month). */
export function CategoryBarChart({
  data,
  color = "var(--color-brand, #0f766e)",
  height = 200,
  money = true,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  money?: boolean;
}) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ed" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={axisTick} width={44} tickFormatter={money ? kesTick : undefined} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [money ? fmtKES(Number(v)) : v, ""]} />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stacked two-series bars (new vs returning customers). */
export function StackedBarChart({
  data,
  series,
  height = 200,
}: {
  data: Record<string, any>[];
  series: { key: string; label: string; color: string }[];
  height?: number;
}) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ed" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={axisTick} width={30} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} iconType="circle" />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined} maxBarSize={34} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const DONUT_COLORS = ["var(--color-brand, #0f766e)", "#5eead4", "#99f6e4", "#a7f3d0", "#fde68a", "#fca5a5", "#d2d2d7", "#86868b"];

/** Breakdown donut with centered total (expense categories). */
export function BreakdownDonut({ data }: { data: { name: string; amountCents: number }[] }) {
  const mounted = useMounted();
  const total = data.reduce((s, d) => s + d.amountCents, 0);

  return (
    <div className="flex items-center gap-5 flex-wrap sm:flex-nowrap">
      <div className="relative h-40 w-40 shrink-0 mx-auto sm:mx-0">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="amountCents" nameKey="name" innerRadius={50} outerRadius={72} paddingAngle={2} strokeWidth={0}>
                {data.map((d, i) => <Cell key={d.name} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => [fmtKES(Number(v)), name]} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-40 w-40 rounded-full bg-[var(--color-ink-50)]/40 animate-pulse" />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[15px] font-semibold tnum leading-none">{fmtKES(total).replace(".00", "")}</div>
          <div className="text-[10px] text-[var(--color-ink-400)] mt-1">total</div>
        </div>
      </div>
      <ul className="space-y-1.5 text-[12px] min-w-0 flex-1">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="text-[var(--color-ink-600)] truncate">{d.name}</span>
            <span className="ml-auto pl-2 font-medium tnum shrink-0">{fmtKES(d.amountCents).replace(".00", "")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RING_COLORS = ["var(--color-brand, #0f766e)", "#5eead4", "#fde68a", "#fca5a5", "#a7f3d0", "#93c5fd"];

/** One ring per category, radius = a percentage (0-100). Margin % by event type. */
export function RadialRingChart({ data, height = 240 }: { data: { name: string; pct: number }[]; height?: number }) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;
  if (data.length === 0) return <div style={{ height }} className="w-full flex items-center justify-center text-[12.5px] text-[var(--color-ink-400)]">No data yet</div>;

  const chartData = data.map((d, i) => ({ ...d, fill: RING_COLORS[i % RING_COLORS.length] }));
  return (
    <div className="flex items-center gap-5 flex-wrap sm:flex-nowrap">
      <div style={{ height, width: height }} className="shrink-0 mx-auto sm:mx-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart data={chartData} innerRadius="24%" outerRadius="95%" startAngle={90} endAngle={-270}>
            <RadialBar dataKey="pct" background={{ fill: "var(--color-ink-50, #f5f5f7)" }} cornerRadius={6} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any, _n: any, item: any) => [`${v}%`, item?.payload?.name || ""]} />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1.5 text-[12px] min-w-0 flex-1">
        {chartData.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: d.fill }} />
            <span className="text-[var(--color-ink-600)] truncate">{d.name}</span>
            <span className="ml-auto pl-2 font-medium tnum shrink-0">{d.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Closed radial loop over 12 categories (months) — one value per point, no fill.
 *  Seasonal booking curve: the loop visibly bulges where volume is highest. */
export function RadialTrendChart({ data, height = 260 }: { data: { label: string; value: number }[]; height?: number }) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="75%">
          <PolarGrid stroke="#e8e8ed" />
          <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "#86868b" }} />
          <PolarRadiusAxis tick={{ fontSize: 10, fill: "#86868b" }} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v} event${v === 1 ? "" : "s"}`, ""]} />
          <Radar dataKey="value" stroke="var(--color-brand, #0f766e)" fill="var(--color-brand, #0f766e)" fillOpacity={0.15} strokeWidth={2} dot />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

const NESTED_OUTER = ["var(--color-brand, #0f766e)", "#5eead4", "#fde68a", "#fca5a5", "#a7f3d0", "#93c5fd", "#d2d2d7"];
const NESTED_INNER: Record<string, string> = {
  lead: "#d2d2d7", quoted: "#93c5fd", confirmed: "#5eead4", in_progress: "#fde68a", completed: "var(--color-brand, #0f766e)", cancelled: "#fca5a5",
};

/** Two-ring pie — outer ring by event type, inner ring by status across all
 *  types. Bookings by type, and how they're progressing. */
export function NestedDonut({
  outer,
  inner,
  centerLabel,
  height = 260,
}: {
  outer: { name: string; value: number }[];
  inner: { name: string; value: number }[];
  centerLabel: string;
  height?: number;
}) {
  const mounted = useMounted();
  const total = outer.reduce((s, d) => s + d.value, 0);
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;
  if (total === 0) return <div style={{ height }} className="w-full flex items-center justify-center text-[12.5px] text-[var(--color-ink-400)]">No projects yet</div>;

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={outer} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="88%" paddingAngle={1.5} strokeWidth={0}>
            {outer.map((d, i) => <Cell key={d.name} fill={NESTED_OUTER[i % NESTED_OUTER.length]} />)}
          </Pie>
          <Pie data={inner} dataKey="value" nameKey="name" innerRadius="36%" outerRadius="60%" paddingAngle={1.5} strokeWidth={0}>
            {inner.map((d) => <Cell key={d.name} fill={NESTED_INNER[d.name] || "#d2d2d7"} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => [`${v} project${v === 1 ? "" : "s"}`, name]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-[17px] font-semibold tnum leading-none">{total}</div>
        <div className="text-[10px] text-[var(--color-ink-400)] mt-1">{centerLabel}</div>
      </div>
    </div>
  );
}

/** Floating min–max bar per category — booking lead time (days) by month. */
export function RangeBarChart({ data, height = 220, unit = "" }: { data: { label: string; range: [number, number] }[]; height?: number; unit?: string }) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e8ed" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} dy={8} />
          <YAxis axisLine={false} tickLine={false} tick={axisTick} width={36} tickFormatter={(v) => `${v}${unit}`} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v[0]}${unit} – ${v[1]}${unit}`, "Range"]} />
          <Bar dataKey="range" fill="var(--color-brand, #0f766e)" radius={[4, 4, 4, 4]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const SCATTER_COLORS = ["var(--color-brand, #0f766e)", "#f59e0b", "#3b82f6", "#ec4899", "#8b5cf6", "#10b981"];

/** Budget vs actual invoiced, one dot per project, colored by event type. */
export function BudgetScatterChart({
  series,
  height = 260,
}: {
  series: { name: string; points: { x: number; y: number; label: string }[] }[];
  height?: number;
}) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;
  const hasData = series.some((s) => s.points.length > 0);
  if (!hasData) return <div style={{ height }} className="w-full flex items-center justify-center text-[12.5px] text-[var(--color-ink-400)]">No budgeted projects yet</div>;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8e8ed" />
          <XAxis type="number" dataKey="x" name="Budget" axisLine={false} tickLine={false} tick={axisTick} tickFormatter={kesTick} />
          <YAxis type="number" dataKey="y" name="Invoiced" axisLine={false} tickLine={false} tick={axisTick} width={44} tickFormatter={kesTick} />
          <ZAxis range={[60, 60]} />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ strokeDasharray: "3 3" }}
            formatter={(v: any, name: any) => [fmtKES(Number(v)), name]}
            labelFormatter={() => ""}
          />
          <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} iconType="circle" />
          {series.map((s, i) => (
            <Scatter key={s.name} name={s.name} data={s.points} fill={SCATTER_COLORS[i % SCATTER_COLORS.length]} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Booking → billing flow: lead through completion, then invoiced → collected. */
function SankeyNodeLabel(props: any) {
  const { x, y, width, height, payload, containerWidth } = props;
  const isLeft = x + width / 2 < containerWidth / 2;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="var(--color-brand, #0f766e)" fillOpacity={0.85} rx={2} />
      <text
        x={isLeft ? x - 6 : x + width + 6}
        y={y + height / 2}
        textAnchor={isLeft ? "end" : "start"}
        dominantBaseline="middle"
        fontSize={11}
        fill="#515154"
      >
        {payload.name}
      </text>
    </g>
  );
}

export function FlowSankey({ nodes, links, height = 280 }: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[]; height?: number }) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;
  if (links.length === 0) return <div style={{ height }} className="w-full flex items-center justify-center text-[12.5px] text-[var(--color-ink-400)]">No projects yet</div>;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={{ nodes, links }}
          nodePadding={20}
          nodeWidth={10}
          margin={{ left: 60, right: 70, top: 8, bottom: 8 }}
          linkCurvature={0.5}
          link={{ stroke: "var(--color-brand, #0f766e)", strokeOpacity: 0.25 }}
          node={<SankeyNodeLabel />}
        >
          <Tooltip contentStyle={tooltipStyle} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

/** Filled multi-axis profile — up to 2 series (e.g. this year vs last year). */
export function RadarProfileChart({
  data,
  series,
  height = 260,
}: {
  data: Record<string, any>[];
  series: { key: string; label: string; color: string }[];
  height?: number;
}) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="#e8e8ed" />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "#86868b" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#86868b" }} tickFormatter={(v) => `${v}%`} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => [`${v}%`, name]} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} iconType="circle" />}
          {series.map((s) => (
            <Radar key={s.key} name={s.label} dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={0.18} strokeWidth={2} />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Sales funnel — Lead → Quoted → Confirmed → Completed, real counts. */
export function FunnelStages({ data, height = 260 }: { data: { name: string; value: number; fill: string }[]; height?: number }) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;
  if (data.every((d) => d.value === 0)) return <div style={{ height }} className="w-full flex items-center justify-center text-[12.5px] text-[var(--color-ink-400)]">No projects yet</div>;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <FunnelChart>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => [`${v} project${v === 1 ? "" : "s"}`, name]} />
          <Funnel dataKey="value" data={data} isAnimationActive>
            <LabelList position="right" dataKey="name" fill="#515154" stroke="none" fontSize={12} />
            <LabelList position="center" dataKey="value" fill="#fff" stroke="none" fontSize={13} fontWeight={600} />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    </div>
  );
}
