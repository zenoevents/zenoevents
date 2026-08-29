"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateReferralCodeAction, markReferralRewardPaidAction } from "@/lib/leads";
import { fmtKES } from "@/lib/money";

interface ReferralReward {
  id: number;
  status: string;
  amountCentsLabel?: string;
  paidOn: string | null;
}
interface ReferralCodeRow {
  id: number;
  code: string;
  rewardType: string;
  rewardValue: number;
  leadCount: number;
  wonCount: number;
  rewards: { id: number; status: string; paidOn: string | null; createdAt: string }[];
}

function rewardLabel(rewardType: string, rewardValue: number) {
  if (rewardType === "cash") return fmtKES(rewardValue);
  if (rewardType === "discount_pct") return `${rewardValue}% discount`;
  return "No reward set";
}

export function ReferralCard({ contactId, baseFormUrl, codes }: { contactId: number; baseFormUrl: string | null; codes: ReferralCodeRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rewardType, setRewardType] = useState("none");
  const [rewardValue, setRewardValue] = useState("");

  function generate() {
    setError(null);
    start(async () => {
      const res = await generateReferralCodeAction(contactId, rewardType, Number(rewardValue) || 0);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function markPaid(rewardId: number) {
    start(async () => {
      await markReferralRewardPaidAction(rewardId, new Date().toISOString().slice(0, 10));
      router.refresh();
    });
  }

  return (
    <div className="card p-4 mt-4 space-y-3">
      <div className="text-[13px] font-semibold text-[var(--color-ink-600)]">Referral</div>

      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap items-center">
          <select value={rewardType} onChange={(e) => setRewardType(e.target.value)} className="rounded-md border border-[var(--color-ink-200)] px-2 py-1.5 text-[12.5px] bg-white">
            <option value="none">No reward</option>
            <option value="discount_pct">Discount %</option>
            <option value="cash">Cash (KSh)</option>
          </select>
          {rewardType !== "none" && (
            <input
              value={rewardValue}
              onChange={(e) => setRewardValue(e.target.value)}
              placeholder={rewardType === "cash" ? "Amount" : "Percent"}
              className="w-24 rounded-md border border-[var(--color-ink-200)] px-2 py-1.5 text-[12.5px]"
            />
          )}
          <button onClick={generate} disabled={pending} className="rounded-md bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[12.5px] font-medium px-3 py-1.5">
            {codes.length === 0 ? "Generate referral code" : "Generate another code"}
          </button>
        </div>
        {error && <div className="text-[11.5px] text-[var(--color-bad)]">{error}</div>}
      </div>

      {codes.length > 0 && (
        <div className="space-y-3">
          {codes.map((c) => (
            <div key={c.id} className="border border-[var(--color-ink-100)] rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-[13px] font-mono font-semibold">{c.code}</div>
                  <div className="text-[11px] text-[var(--color-ink-400)]">{rewardLabel(c.rewardType, c.rewardValue)} · {c.leadCount} lead{c.leadCount === 1 ? "" : "s"} · {c.wonCount} won</div>
                </div>
                {baseFormUrl && (
                  <input
                    readOnly
                    value={`${baseFormUrl}&ref=${c.code}`}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 min-w-[200px] rounded-md border border-[var(--color-ink-200)] px-2 py-1 text-[11px] font-mono bg-[var(--color-ink-50)]"
                  />
                )}
              </div>
              {c.rewards.filter((r) => r.status !== "pending").length > 0 && (
                <div className="space-y-1">
                  {c.rewards.filter((r) => r.status !== "pending").map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-[11.5px]">
                      <span className={r.status === "paid" ? "text-[var(--color-ink-400)]" : "text-amber-700 font-medium"}>
                        {r.status === "paid" ? `Paid ${r.paidOn}` : "Earned — unpaid"}
                      </span>
                      {r.status === "earned" && (
                        <button onClick={() => markPaid(r.id)} disabled={pending} className="text-[var(--color-accent-600)] font-medium hover:underline">
                          Mark paid
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
