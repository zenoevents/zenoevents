"use client";

import { useState } from "react";
import { createDamageReportAction } from "@/lib/damage-reports";
import { DAMAGE_TYPES, STAGE_OPTIONS } from "@/lib/liability-status";

type InventoryOption = { id: number; label: string; itemName: string | null };
type DamageRow = {
  id: number;
  itemLabel: string | null;
  itemName: string | null;
  damageType: string;
  description: string | null;
  stageReported: string;
  liabilityStatus: string;
  createdAt: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const stageLabels: Record<string, string> = {
  loading: "Loading (before it left the store)",
  collection: "Collection (picked up from venue)",
  inspection: "Inspection (back at the warehouse)",
};

const liabilityLabels: Record<string, string> = {
  pending: "Awaiting review",
  staff_fault: "Staff/warehouse fault",
  client_fault: "Client fault — billed",
  wear_and_tear: "Normal wear and tear",
  unresolved: "Unresolved",
};

export function DamageReportPanel({
  projectId,
  inventoryOptions,
  reports,
}: {
  projectId: number;
  inventoryOptions: InventoryOption[];
  reports: DamageRow[];
}) {
  const [inventoryItemId, setInventoryItemId] = useState<number | "">("");
  const [damageType, setDamageType] = useState("broken");
  const [stageReported, setStageReported] = useState("inspection");
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setMimeType(file.type);
    setBase64(await fileToBase64(file));
  }

  async function submit() {
    setError(null);
    if (!inventoryItemId) { setError("Pick which item was damaged"); return; }
    if (!base64 || !mimeType) { setError("A photo is required — no report without one"); return; }
    setPending(true);
    try {
      const result = await createDamageReportAction({
        inventoryItemId: Number(inventoryItemId),
        projectId,
        damageType,
        stageReported,
        description,
        base64Image: base64,
        mimeType,
      });
      if ("error" in result) { setError(result.error); return; }
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {reports.length > 0 && (
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-[var(--color-ink-100)] px-3 py-2 text-[13px]">
              <div>
                <div className="font-medium">{r.itemName} — {r.itemLabel} · {r.damageType}</div>
                <div className="text-[11.5px] text-[var(--color-ink-400)]">{stageLabels[r.stageReported] ?? r.stageReported}</div>
              </div>
              <span className="text-[11px] font-medium text-[var(--color-ink-600)] shrink-0 ml-3">{liabilityLabels[r.liabilityStatus] ?? r.liabilityStatus}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 space-y-2.5">
        <div className="text-[12px] font-medium text-[var(--color-ink-600)]">Report damage</div>

        <select
          value={inventoryItemId}
          onChange={(e) => setInventoryItemId(e.target.value ? Number(e.target.value) : "")}
          className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
        >
          <option value="">Which item?</option>
          {inventoryOptions.map((o) => <option key={o.id} value={o.id}>{o.itemName} — {o.label}</option>)}
        </select>

        <div className="grid grid-cols-2 gap-2">
          <select value={damageType} onChange={(e) => setDamageType(e.target.value)} className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] capitalize">
            {DAMAGE_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
          <select value={stageReported} onChange={(e) => setStageReported(e.target.value)} className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]">
            {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}
          </select>
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What happened (optional)"
          className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
        />

        <div>
          <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
            Photo <span className="font-normal text-[var(--color-bad)]">— required, camera only</span>
          </span>
          <div className="mt-1 flex items-center gap-3">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Damage preview" className="h-14 w-14 rounded-lg object-cover border border-[var(--color-ink-200)]" />
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhoto}
              className="text-[12.5px] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-ink-100)] file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium"
            />
          </div>
        </div>

        {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}

        <button
          disabled={pending}
          onClick={submit}
          className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2 transition-colors disabled:opacity-50"
        >
          {pending ? "Submitting…" : "Submit report"}
        </button>
      </div>
    </div>
  );
}
