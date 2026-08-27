"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fmtKES } from "@/lib/money";
import { initiateSubscriptionPaymentAction, initiateCardPaymentAction, checkSubscriptionPaymentAction } from "./actions";
import { Player } from "@lottiefiles/react-lottie-player";

type HistoryRow = { id: string; date: string; amountCents: number; kind: string; source: string };

function daysUntil(dateISO: string): number {
  return Math.ceil((new Date(dateISO).getTime() - Date.now()) / 86400000);
}

const FEATURE_GROUPS: { title: string; items: string[] }[] = [
  {
    title: "Sales & Billing",
    items: [
      "Unlimited invoices & quotes",
      "eTIMS-compliant VAT invoicing",
      "Recurring invoices, bills & expenses",
      "Credit notes & customer statements",
      "Quote templates & one-click conversion",
    ],
  },
  {
    title: "Events & Inventory",
    items: [
      "Projects as the hub — quotes, invoices, files, tasks in one place",
      "Event Inventory — rental gear tracked as reservable batches",
      "Warehouse manifests — pick, load, dispatch, return, reconcile",
      "Damage reports with photo evidence",
      "Payment milestones & deposit schedules",
    ],
  },
  {
    title: "Payments & Banking",
    items: [
      "M-Pesa & card payment gateways",
      "Automated payment matching & reconciliation",
      "SMS invoice & payment reminders",
      "B2B payouts to vendors and staff",
      "Multi-account bank & cash tracking",
    ],
  },
  {
    title: "Team & Operations",
    items: [
      "Unlimited staff seats & custom roles",
      "Payroll & KRA-compliant payslips",
      "Customer self-service portal",
      "Purchase orders & multi-warehouse stock",
      "Full analytics & reporting suite",
    ],
  },
];

const MAINTENANCE_COVERS = [
  "Hosting & infrastructure, kept fast and always on",
  "Continuous feature updates — you get every new release, no upgrade needed",
  "KRA & eTIMS compliance kept current as regulations change",
  "Daily backups and data safety",
  "Direct support from the team that built it",
];

const WHY_US = [
  { title: "Built for Kenyan event companies", body: "Not a generic accounting tool with events bolted on — reservations, manifests, and damage tracking are first-class, not workarounds." },
  { title: "One fee, everything included", body: "No feature paywalls, no per-seat charges, no surprise upsells. What you see here is what you get." },
  { title: "eTIMS-ready from day one", body: "VAT invoicing, KRA compliance, and tax filing prep built in, not an afterthought." },
  { title: "A human, not a ticket queue", body: "Support and onboarding come directly from the people running the platform." },
];

export function BillingClient({
  status,
  paidUntil,
  oneTimeFeeCents,
  monthlyFeeCents,
  history,
  orgPhone,
  orgEmail,
}: {
  status: "active" | "locked";
  paidUntil: string;
  oneTimeFeeCents: number;
  monthlyFeeCents: number;
  history: HistoryRow[];
  orgPhone: string;
  orgEmail: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const daysLeft = daysUntil(paidUntil);

  const [modal, setModal] = useState<{
    isOpen: boolean;
    method: "mpesa" | "card";
    phone: string;
    email: string;
    status: "idle" | "processing" | "redirecting" | "success" | "error";
    error?: string;
  }>({ isOpen: false, method: "mpesa", phone: orgPhone, email: orgEmail, status: "idle" });

  const pollPayment = async (paymentId: number) => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const check = await checkSubscriptionPaymentAction(paymentId);
      if ("error" in check && check.error) {
        setModal((prev) => ({ ...prev, isOpen: true, status: "error", error: check.error }));
        return;
      }
      if ("status" in check) {
        if (check.status === "complete") {
          setModal((prev) => ({ ...prev, isOpen: true, status: "success" }));
          setTimeout(() => window.location.reload(), 2500);
          return;
        }
        if (check.status === "failed") {
          setModal((prev) => ({ ...prev, isOpen: true, status: "error", error: check.reason || "Payment failed — no money was taken." }));
          return;
        }
      }
    }
    setModal((prev) => ({
      ...prev,
      isOpen: true,
      status: "error",
      error: "We didn't get a confirmation in time. If you completed the payment, your access will extend automatically within a few minutes.",
    }));
  };

  useEffect(() => {
    const paymentId = searchParams.get("payment");
    if (!paymentId) return;
    setModal((prev) => ({ ...prev, isOpen: true, status: "processing" }));
    router.replace("/settings/billing");
    pollPayment(Number(paymentId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePayment = async () => {
    if (!modal.phone) return;
    setModal((prev) => ({ ...prev, status: "processing", error: undefined }));
    try {
      const res = await initiateSubscriptionPaymentAction(modal.phone);
      if ("error" in res && res.error) {
        setModal((prev) => ({ ...prev, status: "error", error: res.error }));
        return;
      }
      await pollPayment((res as { paymentId: number }).paymentId);
    } catch (e: any) {
      setModal((prev) => ({ ...prev, status: "error", error: e.message || "An error occurred." }));
    }
  };

  const handleCardPayment = async () => {
    if (!modal.email) return;
    setModal((prev) => ({ ...prev, status: "redirecting", error: undefined }));
    try {
      const res = await initiateCardPaymentAction(modal.email);
      if ("error" in res && res.error) {
        setModal((prev) => ({ ...prev, status: "error", error: res.error }));
        return;
      }
      window.location.href = (res as { checkoutUrl: string }).checkoutUrl;
    } catch (e: any) {
      setModal((prev) => ({ ...prev, status: "error", error: e.message || "An error occurred." }));
    }
  };

  return (
    <div className="space-y-16 pb-12 relative">
      {status === "locked" && (
        <div className="max-w-5xl mx-auto px-4">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-red-900">
            <div className="text-sm font-semibold">Your access ended on {paidUntil}.</div>
            <div className="mt-1 text-sm text-red-800">Pay now below, or contact us to reactivate your account.</div>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="relative pt-12 pb-8 text-center rounded-3xl overflow-hidden bg-gradient-to-b from-[var(--color-brand)]/10 to-transparent">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-2xl bg-[var(--color-brand)]/5 blur-3xl rounded-full" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold rounded-full bg-[var(--color-brand)]/10 text-[var(--color-brand)] mb-4">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            {status === "locked" ? "Access paused" : daysLeft <= 14 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left on your trial` : "Your account is active"}
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-[var(--color-ink-900)] tracking-tight">
            One Plan. <br className="md:hidden" /> Everything Included.
          </h1>
          <p className="mt-4 text-base text-[var(--color-ink-600)] max-w-2xl mx-auto px-4">
            No tiers, no feature paywalls, no per-seat charges. Every org gets the full platform — you just pay a simple setup fee once, and a monthly fee to keep it running and improving.
          </p>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md mx-auto px-4">
            <div className="bg-white rounded-2xl border border-[var(--color-ink-100)] shadow-sm px-5 py-4 text-left">
              <div className="text-[12px] text-[var(--color-ink-500)]">One-time setup fee</div>
              <div className="text-[24px] font-extrabold mt-1">{fmtKES(oneTimeFeeCents).replace(".00", "")}</div>
            </div>
            <div className="bg-white rounded-2xl border border-[var(--color-ink-100)] shadow-sm px-5 py-4 text-left">
              <div className="text-[12px] text-[var(--color-ink-500)]">Monthly maintenance</div>
              <div className="text-[24px] font-extrabold mt-1">{fmtKES(monthlyFeeCents).replace(".00", "")}</div>
            </div>
          </div>

          {monthlyFeeCents > 0 && (
            <button
              onClick={() => setModal((prev) => ({ ...prev, isOpen: true, status: "idle", error: undefined }))}
              className="mt-6 px-8 py-3.5 rounded-xl text-[14px] font-bold text-white bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-accent-500)] hover:opacity-90 shadow-lg shadow-[var(--color-brand)]/20 transition-all"
            >
              Pay now
            </button>
          )}
          <div className="mt-3 text-[12px] text-[var(--color-ink-400)]">Access guaranteed through {paidUntil}</div>
        </div>
      </div>

      {/* What's included */}
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold rounded-full bg-[var(--color-brand)]/10 text-[var(--color-brand)] mb-4">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            What's included
          </div>
          <h2 className="text-3xl font-extrabold text-[var(--color-ink-900)] tracking-tight">Every feature. No exceptions.</h2>
          <p className="mt-3 text-[15px] text-[var(--color-ink-600)]">The full platform, from your first quote to closing out an event.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {FEATURE_GROUPS.map((group) => (
            <div key={group.title} className="bg-white rounded-3xl border border-[var(--color-ink-100)] shadow-lg p-6">
              <h3 className="text-[14px] font-bold text-[var(--color-ink-900)] mb-4">{group.title}</h3>
              <ul className="space-y-3">
                {group.items.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[13.5px] text-[var(--color-ink-700)] font-medium">
                    <div className="mt-0.5 shrink-0 w-5 h-5 bg-[var(--color-brand)] text-white rounded-full flex items-center justify-center shadow-sm">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* What maintenance covers */}
      <div className="max-w-5xl mx-auto px-4">
        <div className="bg-white rounded-3xl border border-[var(--color-ink-100)] shadow-xl p-8 md:p-10">
          <h2 className="text-2xl font-extrabold text-[var(--color-ink-900)] tracking-tight mb-2">What your monthly fee covers</h2>
          <p className="text-[14px] text-[var(--color-ink-600)] mb-6">It's not a subscription for access — it's what keeps the platform running and improving under you.</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {MAINTENANCE_COVERS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[13.5px] text-[var(--color-ink-700)] font-medium">
                <div className="mt-0.5 shrink-0 w-5 h-5 bg-[var(--color-accent-500)] text-white rounded-full flex items-center justify-center shadow-sm">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Why us */}
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-extrabold text-[var(--color-ink-900)] tracking-tight">Why Zeno</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {WHY_US.map((w) => (
            <div key={w.title} className="rounded-3xl border border-[var(--color-ink-100)] bg-white shadow-lg p-6">
              <h3 className="text-[14px] font-bold text-[var(--color-ink-900)] mb-1.5">{w.title}</h3>
              <p className="text-[13px] text-[var(--color-ink-600)]">{w.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Payment history */}
      <div className="max-w-5xl mx-auto px-4">
        <h2 className="text-[15px] font-bold text-[var(--color-ink-900)] mb-3">Payment history</h2>
        {history.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[var(--color-ink-100)] px-5 py-6 text-center text-[13px] text-[var(--color-ink-400)]">No payments recorded yet.</div>
        ) : (
          <div className="bg-white rounded-2xl border border-[var(--color-ink-100)] shadow-sm divide-y divide-[var(--color-ink-100)] overflow-hidden">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                <div>
                  <div className="font-medium capitalize">{h.kind === "one_time" ? "One-time fee" : "Maintenance fee"}</div>
                  <div className="text-[11.5px] text-[var(--color-ink-400)]">{h.date} · {h.source}</div>
                </div>
                <div className="font-semibold tnum">{fmtKES(h.amountCents).replace(".00", "")}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {modal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => modal.status !== "processing" && setModal((prev) => ({ ...prev, isOpen: false }))} />
          <div className="relative w-full h-[65vh] md:h-auto md:w-[420px] bg-white rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-8 md:slide-in-from-bottom-0 md:zoom-in-95 duration-200 flex flex-col">
            <div className="flex-none flex items-center justify-between p-6 border-b border-[var(--color-ink-100)]">
              <h3 className="text-lg font-bold text-[var(--color-ink-900)]">Pay maintenance fee</h3>
              {modal.status !== "processing" && (
                <button onClick={() => setModal((prev) => ({ ...prev, isOpen: false }))} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--color-ink-100)] text-[var(--color-ink-500)]">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>

            <div className="p-6 flex-1 overflow-y-auto flex flex-col">
              {modal.status === "idle" || modal.status === "error" ? (
                <>
                  <div className="mb-auto">
                    <p className="text-[14px] text-[var(--color-ink-600)] mb-6">
                      You are about to pay <strong>{fmtKES(monthlyFeeCents).replace(".00", "")}</strong> — extends your access by 30 days.
                    </p>
                    <div className="rounded-2xl border border-[var(--color-ink-200)] overflow-hidden divide-y divide-[var(--color-ink-100)]">
                      <div>
                        <button type="button" onClick={() => setModal((prev) => ({ ...prev, method: "mpesa" }))} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-ink-50)] transition-colors">
                          <div className="w-9 h-9 rounded-lg bg-white border border-[var(--color-ink-100)] flex items-center justify-center shrink-0 overflow-hidden">
                            <img src="/images/brand/mpesa-logo.png" alt="" className="w-full h-full object-contain p-0.5" />
                          </div>
                          <span className="flex-1 text-[14px] font-semibold text-[var(--color-ink-900)]">M-Pesa</span>
                          <svg className={`w-4 h-4 text-[var(--color-ink-400)] transition-transform duration-200 ${modal.method === "mpesa" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <div className={`grid transition-all duration-300 ease-in-out ${modal.method === "mpesa" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                          <div className="overflow-hidden">
                            <div className="px-4 pb-4 pt-1">
                              <input
                                type="tel"
                                value={modal.phone}
                                onChange={(e) => setModal((prev) => ({ ...prev, phone: e.target.value }))}
                                placeholder="07XXXXXXXX"
                                className="w-full px-3.5 py-3 bg-[var(--color-ink-50)] border border-[var(--color-ink-200)] rounded-xl text-[14px] focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent outline-none transition-all font-medium"
                              />
                              <p className="mt-2 text-[12px] text-[var(--color-ink-500)]">An STK push will be sent to this number. Please have your phone ready.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div>
                        <button type="button" onClick={() => setModal((prev) => ({ ...prev, method: "card" }))} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-ink-50)] transition-colors">
                          <div className="w-9 h-9 rounded-lg bg-white border border-[var(--color-ink-100)] flex items-center justify-center shrink-0 overflow-hidden">
                            <img src="/images/brand/card-logo.png" alt="" className="w-full h-full object-contain p-0.5" />
                          </div>
                          <span className="flex-1 text-[14px] font-semibold text-[var(--color-ink-900)]">Card</span>
                          <svg className={`w-4 h-4 text-[var(--color-ink-400)] transition-transform duration-200 ${modal.method === "card" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <div className={`grid transition-all duration-300 ease-in-out ${modal.method === "card" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                          <div className="overflow-hidden">
                            <div className="px-4 pb-4 pt-1">
                              <input
                                type="email"
                                value={modal.email}
                                onChange={(e) => setModal((prev) => ({ ...prev, email: e.target.value }))}
                                placeholder="you@business.com"
                                className="w-full px-3.5 py-3 bg-[var(--color-ink-50)] border border-[var(--color-ink-200)] rounded-xl text-[14px] focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent outline-none transition-all font-medium"
                              />
                              <p className="mt-2 text-[12px] text-[var(--color-ink-500)]">You'll be taken to a secure page to enter your card details.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {modal.error && (
                    <div className="my-6 p-3 bg-[var(--color-bad)]/10 text-[var(--color-bad)] rounded-lg text-[13px] font-medium border border-[var(--color-bad)]/20">{modal.error}</div>
                  )}

                  <button
                    onClick={modal.method === "card" ? handleCardPayment : handlePayment}
                    className="w-full mt-6 py-3.5 rounded-xl text-[14px] font-bold text-white bg-[var(--color-brand)] hover:opacity-90 shadow-lg shadow-[var(--color-brand)]/20 transition-all active:scale-[0.98]"
                  >
                    {modal.method === "card" ? "Continue to card payment" : "Pay with M-Pesa"}
                  </button>
                </>
              ) : modal.status === "redirecting" ? (
                <div className="py-10 flex flex-col items-center justify-center text-center flex-1">
                  <div className="w-8 h-8 border-2 border-[var(--color-brand)] border-t-transparent rounded-full animate-spin mb-5" />
                  <h4 className="text-lg font-bold text-[var(--color-ink-900)] mb-2">Taking you to checkout…</h4>
                  <p className="text-[14px] text-[var(--color-ink-500)] max-w-[250px]">Enter your card details on IntaSend's secure page — you'll be brought back here automatically.</p>
                </div>
              ) : modal.status === "processing" ? (
                <div className="py-8 flex flex-col items-center justify-center text-center flex-1">
                  <div className="w-56 h-56 mb-4">
                    <Player autoplay loop src="https://lottie.host/988ad23c-a0b0-492d-b31d-3b60a924e89a/IZdC3LuBul.json" style={{ height: "100%", width: "100%" }} />
                  </div>
                  <h4 className="text-lg font-bold text-[var(--color-ink-900)] mb-2">{modal.method === "card" ? "Confirming Payment" : "Check Your Phone"}</h4>
                  <p className="text-[14px] text-[var(--color-ink-500)] max-w-[250px]">
                    {modal.method === "card" ? "We're confirming your card payment with IntaSend — this only takes a moment." : <>We've sent an M-Pesa prompt to <strong>{modal.phone}</strong>. Please enter your PIN to complete the payment.</>}
                  </p>
                </div>
              ) : (
                <div className="py-10 flex flex-col items-center justify-center text-center flex-1">
                  <div className="w-20 h-20 bg-[var(--color-good)]/10 text-[var(--color-good)] rounded-full flex items-center justify-center mb-6">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <h4 className="text-xl font-bold text-[var(--color-ink-900)] mb-2">Payment Successful!</h4>
                  <p className="text-[14px] text-[var(--color-ink-500)]">Your access has been extended by 30 days.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
