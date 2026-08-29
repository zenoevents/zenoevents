"use client";

import { useState } from "react";
import { submitPublicLeadAction } from "@/lib/leads";

const EVENT_TYPES = ["Wedding", "Corporate", "Birthday", "Graduation", "Other"];

// Small static map — purely this form's UX convenience for showing the
// right follow-up fields per event type; leads.eventType stays free text.
const CONDITIONAL_FIELDS: Record<string, { key: string; label: string; type: "text" | "number" }[]> = {
  Wedding: [
    { key: "guest_count", label: "Approx. guest count", type: "number" },
    { key: "venue_booked", label: "Venue already booked?", type: "text" },
  ],
  Corporate: [
    { key: "company_name", label: "Company name", type: "text" },
    { key: "budget_contact", label: "Budget approval contact", type: "text" },
  ],
  Birthday: [{ key: "guest_count", label: "Approx. guest count", type: "number" }],
  Graduation: [{ key: "guest_count", label: "Approx. guest count", type: "number" }],
};

export function LeadForm({
  slug,
  orgName,
  logoUrl,
  brandColor,
  channel,
  campaign,
  ref_,
}: {
  slug: string;
  orgName: string;
  logoUrl: string | null;
  brandColor: string;
  channel: string;
  campaign: string | null;
  ref_: string | null;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventType, setEventType] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const conditionalFields = CONDITIONAL_FIELDS[eventType] || [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Name and phone are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await submitPublicLeadAction({
      slug,
      channel,
      channelDetail: campaign,
      referralCode: channel === "referral" ? ref_ : null,
      name,
      phone,
      email: email || null,
      eventType: eventType || null,
      eventDate: eventDate || null,
      message: message || null,
      details: Object.keys(details).length > 0 ? details : null,
      website2: honeypot,
    });
    setSubmitting(false);
    if ("error" in res) setError(res.error);
    else setDone(true);
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden px-6 py-10 text-center">
        <div className="text-4xl mb-3">🎉</div>
        <h1 className="text-lg font-semibold mb-1">Thanks, {name.split(" ")[0]}!</h1>
        <p className="text-sm text-gray-500">
          We've received your inquiry{eventDate ? ` for ${eventDate}` : ""} — someone from {orgName} will reach out shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={orgName} className="h-9 w-9 rounded-lg object-cover" />
        ) : (
          <div className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-sm font-semibold" style={{ background: brandColor }}>
            {orgName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <div className="text-base font-semibold">{orgName}</div>
          <div className="text-xs text-gray-500">Tell us about your event</div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-3 text-sm">
        {/* Honeypot — visually hidden off-screen, not display:none, so it still
           reads as a real field to a script filling every input on the page. */}
        <div style={{ position: "absolute", left: "-9999px", top: "-9999px" }} aria-hidden="true">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </label>
        </div>

        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} placeholder="Jane Wanjiru" />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required className={inputCls} placeholder="0722 000 000" />
        </Field>
        <Field label="Event date">
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Event type">
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>

        {conditionalFields.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              type={f.type}
              value={details[f.key] || ""}
              onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
              className={inputCls}
            />
          </Field>
        ))}

        {!expanded ? (
          <button type="button" onClick={() => setExpanded(true)} className="text-xs font-medium" style={{ color: brandColor }}>
            + Tell us more (optional)
          </button>
        ) : (
          <>
            <Field label="Email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Message">
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={inputCls} />
            </Field>
          </>
        )}

        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>

      <div className="px-6 pb-6">
        <button
          type="submit"
          disabled={submitting}
          className="block w-full text-center py-3 rounded-xl text-white text-sm font-medium disabled:opacity-50"
          style={{ background: brandColor }}
        >
          {submitting ? "Sending…" : "Send inquiry"}
        </button>
      </div>
    </form>
  );
}

const inputCls = "w-full rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
