"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLeadChannelAction, generateLeadQrAction } from "@/lib/leads";

interface ChannelRow {
  channel: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

const CHANNEL_META: Record<string, { label: string; icon: string; help: string }> = {
  website: { label: "Website embed", icon: "🌐", help: "An iframe snippet to paste on your own contact page." },
  instagram: { label: "Instagram", icon: "📸", help: "Link for your bio or a boosted post's button." },
  facebook: { label: "Facebook", icon: "📘", help: "Link for a boosted post or page button." },
  whatsapp: { label: "WhatsApp", icon: "💬", help: "Click-to-chat link with a pre-filled message." },
  qr: { label: "QR codes", icon: "🔳", help: "Generate a QR for a physical banner or flyer." },
};

export function LeadChannelsClient({
  channels,
  websiteUrl,
  instagramUrl,
  facebookUrl,
}: {
  channels: ChannelRow[];
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const byChannel = new Map(channels.map((c) => [c.channel, c]));

  function toggle(channel: string, enabled: boolean, config?: Record<string, unknown>) {
    start(async () => {
      await setLeadChannelAction(channel, enabled, config);
      router.refresh();
    });
  }

  const whatsappNumber = (byChannel.get("whatsapp")?.config?.whatsappNumber as string) || "";
  const anyEnabled = channels.some((c) => c.enabled);

  return (
    <div className="space-y-4 max-w-2xl">
      {channels.map((c) => {
        const meta = CHANNEL_META[c.channel];
        return (
          <div key={c.channel} className="card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>{meta.icon}</span>
                <div>
                  <div className="text-[13px] font-semibold">{meta.label}</div>
                  <div className="text-[11.5px] text-[var(--color-ink-400)]">{meta.help}</div>
                </div>
              </div>
              <button
                disabled={pending}
                onClick={() => toggle(c.channel, !c.enabled, c.config ?? undefined)}
                className={`rounded-full px-3 py-1 text-[12px] font-medium ${c.enabled ? "bg-emerald-100 text-emerald-700" : "bg-[var(--color-ink-100)] text-[var(--color-ink-500)]"}`}
              >
                {c.enabled ? "On" : "Off"}
              </button>
            </div>

            {c.enabled && c.channel === "website" && websiteUrl && (
              <div className="mt-3">
                <div className="text-[11.5px] text-[var(--color-ink-400)] mb-1">Paste this on your contact page:</div>
                <textarea
                  readOnly
                  rows={2}
                  className="w-full rounded-md border border-[var(--color-ink-200)] px-2 py-2 text-[11.5px] font-mono bg-[var(--color-ink-50)]"
                  value={`<iframe src="${websiteUrl}" style="width:100%;max-width:480px;height:640px;border:0" title="Contact form"></iframe>`}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
              </div>
            )}

            {c.enabled && c.channel === "instagram" && instagramUrl && (
              <LinkBuilder baseUrl={instagramUrl} />
            )}
            {c.enabled && c.channel === "facebook" && facebookUrl && (
              <LinkBuilder baseUrl={facebookUrl} />
            )}

            {c.enabled && c.channel === "whatsapp" && (
              <WhatsAppBuilder
                whatsappNumber={whatsappNumber}
                onSaveNumber={(num) => toggle("whatsapp", true, { whatsappNumber: num })}
              />
            )}

            {c.enabled && c.channel === "qr" && <QrBuilder disabled={!anyEnabled} />}
          </div>
        );
      })}
    </div>
  );
}

function LinkBuilder({ baseUrl }: { baseUrl: string }) {
  const [campaign, setCampaign] = useState("");
  const url = campaign ? `${baseUrl}&campaign=${encodeURIComponent(campaign)}` : baseUrl;
  return (
    <div className="mt-3 space-y-2">
      <input
        placeholder="Campaign label (optional) — e.g. Aug_Wedding_Promo"
        value={campaign}
        onChange={(e) => setCampaign(e.target.value)}
        className="w-full rounded-md border border-[var(--color-ink-200)] px-2 py-1.5 text-[12.5px]"
      />
      <input readOnly value={url} onClick={(e) => (e.target as HTMLInputElement).select()} className="w-full rounded-md border border-[var(--color-ink-200)] px-2 py-1.5 text-[11.5px] font-mono bg-[var(--color-ink-50)]" />
    </div>
  );
}

function WhatsAppBuilder({ whatsappNumber, onSaveNumber }: { whatsappNumber: string; onSaveNumber: (num: string) => void }) {
  const [num, setNum] = useState(whatsappNumber);
  const chatText = "Hi! I'd like to inquire about an event.";
  const waLink = num ? `https://wa.me/${num.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(chatText)}` : "";
  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        <input
          placeholder="WhatsApp number, e.g. 254722000000"
          value={num}
          onChange={(e) => setNum(e.target.value)}
          className="flex-1 rounded-md border border-[var(--color-ink-200)] px-2 py-1.5 text-[12.5px]"
        />
        <button onClick={() => onSaveNumber(num)} className="rounded-md bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[12px] font-medium px-3">Save</button>
      </div>
      {waLink && (
        <input readOnly value={waLink} onClick={(e) => (e.target as HTMLInputElement).select()} className="w-full rounded-md border border-[var(--color-ink-200)] px-2 py-1.5 text-[11.5px] font-mono bg-[var(--color-ink-50)]" />
      )}
    </div>
  );
}

function QrBuilder({ disabled }: { disabled: boolean }) {
  const [campaign, setCampaign] = useState("");
  const [result, setResult] = useState<{ url: string; dataUrl: string } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function generate() {
    start(async () => {
      const res = await generateLeadQrAction(campaign || "QR");
      if ("error" in res) setError(res.error);
      else { setError(null); setResult(res); }
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        <input
          placeholder="Source name — e.g. Wedding Expo 2026"
          value={campaign}
          onChange={(e) => setCampaign(e.target.value)}
          className="flex-1 rounded-md border border-[var(--color-ink-200)] px-2 py-1.5 text-[12.5px]"
        />
        <button disabled={disabled || pending} onClick={generate} className="rounded-md bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[12px] font-medium px-3">
          {pending ? "…" : "Generate"}
        </button>
      </div>
      {error && <div className="text-[11.5px] text-[var(--color-bad)]">{error}</div>}
      {result && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.dataUrl} alt="Lead form QR code" className="h-24 w-24 rounded-md border border-[var(--color-ink-200)]" />
          <a href={result.dataUrl} download={`lead-qr-${campaign || "qr"}.png`} className="text-[12px] text-[var(--color-accent-600)] font-medium hover:underline">Download PNG</a>
        </div>
      )}
    </div>
  );
}
