"use client";

import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { fmtKES } from "@/lib/money";

/** Recharts always shows a hover cursor + tooltip for whichever category
 *  band the mouse is over, even a month with zero income and zero expense —
 *  on an org with only a couple of active months, that reads as a floating,
 *  disconnected "0.00 / 0.00" popup with no bar anywhere near it, which
 *  looks broken even though the underlying data is correct. Suppress the
 *  tooltip (return null) for genuinely empty months instead. */
function ActivityTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const income = payload.find((p: any) => p.dataKey === "Income")?.value ?? 0;
  const expense = payload.find((p: any) => p.dataKey === "Expense")?.value ?? 0;
  if (income === 0 && expense === 0) return null;
  return (
    <div
      style={{ borderRadius: 8, border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)", fontSize: 13, background: "white", padding: "8px 12px" }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ color: "#ff3b30" }}>Expense : {fmtKES(expense * 100)}</div>
      <div style={{ color: "#34c759" }}>Income : {fmtKES(income * 100)}</div>
    </div>
  );
}

export function IncomeExpenseChart({ data }: { data: { month: string; label: string; incomeCents: number; expenseCents: number }[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Convert cents to standard units for the chart
  const formattedData = data.map((d) => ({
    ...d,
    Income: d.incomeCents / 100,
    Expense: d.expenseCents / 100,
  }));

  if (!mounted) {
    return <div className="flex-1 min-h-64 w-full bg-[var(--color-ink-50)]/40 rounded-lg animate-pulse" />;
  }

  return (
    <div className="flex-1 min-h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formattedData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5ea" />
          <XAxis 
            dataKey="label" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12, fill: "#86868b" }} 
            dy={10}
          />
          <YAxis 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12, fill: "#86868b" }}
            tickFormatter={(value) => `${value >= 1000 ? (value / 1000).toFixed(0) + "k" : value}`}
            dx={-10}
          />
          <Tooltip cursor={{ fill: "#f5f5f7" }} content={<ActivityTooltip />} />
          <Legend wrapperStyle={{ fontSize: "13px", paddingTop: "10px" }} iconType="circle" />
          <Bar dataKey="Income" fill="#34c759" radius={[4, 4, 0, 0]} maxBarSize={40} />
          <Bar dataKey="Expense" fill="#ff3b30" radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
