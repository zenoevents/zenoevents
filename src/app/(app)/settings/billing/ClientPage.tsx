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
    <div className="max-w-2xl space-y-6 relative">
      {/* Status */}
      <div className={`rounded-2xl border px-5 py-4 ${status === "locked" ? "border-red-200 bg-red-50" : "border-[var(--color-ink-100)] bg-white"}`}>
        {status === "locked" ? (
          <>
            <div className="text-[14px] font-semibold text-red-900">Access paused</div>
            <div className="mt-1 text-[13px] text-red-800">Your trial or subscription ended on {paidUntil}. Contact us or pay now to reactivate.</div>
          </>
        ) : (
          <>
            <div className="text-[14px] font-semibold">Active{daysLeft <= 14 ? ` — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : ""}</div>
            <div className="mt-1 text-[13px] text-[var(--color-ink-500)]">Access guaranteed through {paidUntil}.</div>
          </>
        )}
      </div>

      {/* Fees */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-[var(--color-ink-100)] bg-white px-5 py-4">
          <div className="text-[12px] text-[var(--color-ink-500)]">One-time setup fee</div>
          <div className="text-[22px] font-bold mt-1">{fmtKES(oneTimeFeeCents).replace(".00", "")}</div>
        </div>
        <div className="rounded-2xl border border-[var(--color-ink-100)] bg-white px-5 py-4">
          <div className="text-[12px] text-[var(--color-ink-500)]">Monthly maintenance fee</div>
          <div className="text-[22px] font-bold mt-1">{fmtKES(monthlyFeeCents).replace(".00", "")}</div>
        </div>
      </div>

      {monthlyFeeCents > 0 && (
        <button
          onClick={() => setModal((prev) => ({ ...prev, isOpen: true, status: "idle", error: undefined }))}
          className="w-full py-3 rounded-xl text-[14px] font-semibold text-white bg-[var(--color-brand)] hover:opacity-90 shadow-sm"
        >
          Pay now
        </button>
      )}

      {/* History */}
      <div>
        <div className="text-[13px] font-semibold mb-2">Payment history</div>
        {history.length === 0 ? (
          <div className="text-[13px] text-[var(--color-ink-400)]">No payments recorded yet.</div>
        ) : (
          <div className="rounded-2xl border border-[var(--color-ink-100)] bg-white divide-y divide-[var(--color-ink-100)]">
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
