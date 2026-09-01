"use client";

import { useEffect, useState } from "react";
import type { RingData } from "./activity-rings-data";

function Ring({ data, radius, strokeWidth, animate }: { data: RingData; radius: number; strokeWidth: number; animate: boolean }) {
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, data.pct));
  const offset = circumference - (filled / 100) * circumference;

  return (
    <>
      <circle cx="100" cy="100" r={radius} fill="none" stroke={data.colorSoft} strokeWidth={strokeWidth} />
      <circle
        cx="100" cy="100" r={radius} fill="none"
        stroke={data.color} strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={animate ? offset : circumference}
        strokeLinecap="round"
        transform="rotate(-90 100 100)"
        style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)" }}
      />
    </>
  );
}

/** Three-ring "activity" summary — collected/booking/timeline progress, all
 *  client-safe (no cost basis, no internal ops detail). Plain SVG + a CSS
 *  transition triggered post-mount, no animation library — this app has no
 *  motion/framer-motion dependency and this doesn't need to be the one
 *  thing that adds it. */
export function ActivityRings({ rings }: { rings: [RingData, RingData, RingData] }) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimate(true), 80);
    return () => clearTimeout(t);
  }, []);

  const radii = [82, 60, 38];
  const strokeWidth = 15;

  return (
    <div className="card p-6">
      <div className="flex flex-col sm:flex-row items-center gap-8">
        <svg viewBox="0 0 200 200" width="200" height="200" className="shrink-0">
          {rings.map((r, i) => (
            <Ring key={r.label} data={r} radius={radii[i]} strokeWidth={strokeWidth} animate={animate} />
          ))}
        </svg>
        <div className="flex flex-col gap-4 w-full">
          {rings.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-500)]">{r.label}</span>
              </div>
              <div className="text-right">
                <div className="text-[15px] font-bold tnum" style={{ color: r.color }}>{Math.round(r.pct)}%</div>
                <div className="text-[11px] text-[var(--color-ink-400)]">{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
