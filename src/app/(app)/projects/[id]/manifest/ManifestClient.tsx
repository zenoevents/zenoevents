"use client";

import { useState } from "react";
import {
  createManifestAction, addConsumableLineAction, confirmManifestAction,
  advanceLineStatusAction, inspectLineAction, reconcileManifestAction,
} from "@/lib/manifests";
import { createDamageReportAction } from "@/lib/damage-reports";
import { LINE_TRANSITIONS, LINE_STATUS_LABELS, type LineStatus } from "@/lib/manifest-status";
import { PrimaryButton, EmptyState } from "@/components/ui";

type Line = {
  id: number;
  lineType: string;
  inventoryItemId: number | null;
  itemLabel: string | null;
  itemName: string | null;
  description: string;
  qtyRequested: number;
  qtyUsed: number | null;
  status: string;
  checkedByName: string | null;
  checkedAt: string | null;
  notes: string | null;
  damageReportId: number | null;
};

type Manifest = {
  id: number;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
  reconciledAt: string | null;
  lines: Line[];
};

const manifestStatusLabels: Record<string, string> = {
  draft: "Draft", confirmed: "Confirmed", in_progress: "In progress", reconciled: "Reconciled",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function DamageInline({ line, projectId, onDone }: { line: Line; projectId: number; onDone: () => void }) {
  const [damageType, setDamageType] = useState<"broken" | "missing" | "other">("broken");
  const [base64, setBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
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
    if (!line.inventoryItemId) { setError("This line has no inventory item to report"); return; }
    if (!base64 || !mimeType) { setError("A photo is required"); return; }
    setPending(true);
    try {
      const result = await createDamageReportAction({
        inventoryItemId: line.inventoryItemId,
        projectId,
        manifestLineId: line.id,
        damageType,
        stageReported: "inspection",
        base64Image: base64,
        mimeType,
      });
      if ("error" in result) { setError(result.error); return; }
      onDone();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-dashed border-[var(--color-bad)]/40 p-3 space-y-2">
      <select value={damageType} onChange={(e) => setDamageType(e.target.value as any)} className="rounded-lg border border-[var(--color-ink-200)] bg-white px-2 py-1.5 text-[12.5px]">
        <option value="broken">Broken</option>
        <option value="missing">Missing</option>
        <option value="other">Other</option>
      </select>
      <div className="flex items-center gap-2">
        {preview && <img src={preview} alt="preview" className="h-10 w-10 rounded object-cover border border-[var(--color-ink-200)]" />}
        <input type="file" accept="image/*" capture="environment" onChange={handlePhoto}
          className="text-[11.5px] file:mr-2 file:rounded-lg file:border-0 file:bg-[var(--color-ink-100)] file:px-2 file:py-1 file:text-[11.5px]" />
      </div>
      {error && <div className="text-[11.5px] text-[var(--color-bad)]">{error}</div>}
      <button disabled={pending} onClick={submit} className="text-[12px] font-medium text-white bg-[var(--color-bad)] rounded-lg px-3 py-1.5 disabled:opacity-50">
        {pending ? "Submitting…" : "Submit damage report"}
      </button>
    </div>
  );
}

function LineRow({ line, projectId, viewerRole, isAdmin, onChanged }: { line: Line; projectId: number; viewerRole: string; isAdmin: boolean; onChanged: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDamage, setShowDamage] = useState(false);

  async function advance(to: LineStatus) {
    setError(null);
    setPending(true);
    try {
      const result = await advanceLineStatusAction(line.id, to);
      if ("error" in result) { setError(result.error); return; }
      onChanged();
    } finally {
      setPending(false);
    }
  }

  async function inspectGood(outcome: "good" | "needs_cleaning") {
    setError(null);
    setPending(true);
    try {
      const result = await inspectLineAction(line.id, outcome);
      if ("error" in result) { setError(result.error); return; }
      onChanged();
    } finally {
      setPending(false);
    }
  }

  const transitions = (LINE_TRANSITIONS[line.status] ?? []).filter((t) => isAdmin || t.role === viewerRole);
  const canInspect = line.status === "returned" && (isAdmin || viewerRole === "warehouse_staff");
  const isTerminal = line.status.startsWith("inspected_");

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-[13.5px]">
            {line.itemName ? `${line.itemName} — ${line.itemLabel}` : line.description}
          </div>
          <div className="text-[11.5px] text-[var(--color-ink-400)]">
            {line.lineType === "consumable" ? "Consumable" : "Durable"} · qty {line.qtyRequested}
            {line.checkedByName ? ` · last touched by ${line.checkedByName}` : ""}
          </div>
        </div>
        <span className={`text-[11px] font-medium shrink-0 rounded-full px-2.5 py-1 ${isTerminal ? (line.status.includes("damaged") || line.status.includes("missing") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700") : "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]"}`}>
          {LINE_STATUS_LABELS[line.status] ?? line.status}
        </span>
      </div>

      {error && <div className="mt-1.5 text-[11.5px] text-[var(--color-bad)]">{error}</div>}

      {transitions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {transitions.map((t) => (
            <button key={t.to} disabled={pending} onClick={() => advance(t.to)}
              className="text-[12px] font-medium text-[var(--color-accent-600)] hover:underline disabled:opacity-50">
              {t.label}
            </button>
          ))}
        </div>
      )}

      {canInspect && !isTerminal && (
        <div className="mt-2 flex flex-wrap gap-3">
          <button disabled={pending} onClick={() => inspectGood("good")} className="text-[12px] font-medium text-[var(--color-good)] hover:underline">Good — back to store</button>
          <button disabled={pending} onClick={() => inspectGood("needs_cleaning")} className="text-[12px] font-medium text-[var(--color-warn)] hover:underline">Needs cleaning</button>
          <button disabled={pending} onClick={() => setShowDamage((s) => !s)} className="text-[12px] font-medium text-[var(--color-bad)] hover:underline">Report damage / missing</button>
        </div>
      )}

      {showDamage && <DamageInline line={line} projectId={projectId} onDone={onChanged} />}
    </div>
  );
}

export function ManifestClient({
  projectId, manifest, viewerRole, isAdmin,
}: {
  projectId: number;
  manifest: Manifest | null;
  viewerRole: string;
  isAdmin: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [consumableDesc, setConsumableDesc] = useState("");
  const [consumableQty, setConsumableQty] = useState("1");

  async function create() {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createManifestAction(projectId);
      if ("error" in result) { setCreateError(result.error); return; }
      window.location.reload();
    } finally {
      setCreating(false);
    }
  }

  function refresh() {
    window.location.reload();
  }

  async function addConsumable() {
    if (!manifest) return;
    const qty = parseFloat(consumableQty);
    const result = await addConsumableLineAction(manifest.id, consumableDesc, qty);
    if (!("error" in result)) window.location.reload();
  }

  async function confirm() {
    if (!manifest) return;
    await confirmManifestAction(manifest.id);
    window.location.reload();
  }

  async function reconcile() {
    if (!manifest) return;
    const result = await reconcileManifestAction(manifest.id);
    if ("error" in result) alert(result.error);
    else window.location.reload();
  }

  if (!manifest) {
    return (
      <EmptyState
        title="No manifest yet"
        body="Creating one pulls in every reserved item as a checklist line — pick, load, dispatch, collect, return, inspect — plus room to add consumables like flowers."
        action={
          <div>
            <PrimaryButton onClick={create} disabled={creating}>{creating ? "Creating…" : "Create manifest"}</PrimaryButton>
            {createError && <div className="mt-2 text-[12.5px] text-[var(--color-bad)]">{createError}</div>}
          </div>
        }
      />
    );
  }

  const durableLines = manifest.lines.filter((l) => l.lineType === "durable");
  const allInspected = durableLines.every((l) => l.status.startsWith("inspected_"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">
          Status: <span className="text-[var(--color-accent-600)]">{manifestStatusLabels[manifest.status] ?? manifest.status}</span>
        </span>
        <div className="flex gap-2">
          {isAdmin && manifest.status === "draft" && <button onClick={confirm} className="text-[12.5px] font-medium text-white bg-[var(--color-accent-500)] rounded-lg px-3 py-1.5">Confirm manifest</button>}
          {isAdmin && (manifest.status === "confirmed" || manifest.status === "in_progress") && (
            <button disabled={!allInspected} onClick={reconcile} className="text-[12.5px] font-medium text-white bg-[var(--color-accent-500)] rounded-lg px-3 py-1.5 disabled:opacity-50">
              Reconcile
            </button>
          )}
        </div>
      </div>

      {manifest.lines.length === 0 ? (
        <div className="text-[13px] text-[var(--color-ink-400)]">No lines yet — no reservations on this project when the manifest was created.</div>
      ) : (
        <div className="space-y-2">
          {manifest.lines.map((l) => <LineRow key={l.id} line={l} projectId={projectId} viewerRole={viewerRole} isAdmin={isAdmin} onChanged={refresh} />)}
        </div>
      )}

      {isAdmin && manifest.status !== "reconciled" && (
        <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 space-y-2">
          <div className="text-[12px] font-medium text-[var(--color-ink-600)]">Add a consumable (flowers, linens, etc.)</div>
          <div className="flex gap-2">
            <input value={consumableDesc} onChange={(e) => setConsumableDesc(e.target.value)} placeholder="Description" className="flex-1 rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px]" />
            <input value={consumableQty} onChange={(e) => setConsumableQty(e.target.value)} type="number" min="0.01" step="0.01" className="w-24 rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px]" />
            <button onClick={addConsumable} className="rounded-lg bg-[var(--color-accent-500)] text-white text-[13px] font-medium px-4 py-2">Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
