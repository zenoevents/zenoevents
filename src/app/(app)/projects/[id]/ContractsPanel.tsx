"use client";

import { useState } from "react";
import { createContractAction, updateContractStatusAction, signContractAction, deleteContractAction } from "@/lib/contracts";
import { CONTRACT_STATUS_LABELS, type ContractStatus } from "@/lib/contract-status";
import { fmtKES } from "@/lib/money";
import { PhotoCapture } from "@/components/PhotoCapture";
import { EmptyState } from "@/components/ui";

type ContractRow = {
  id: number;
  subject: string;
  valueCents: number;
  startDate: string;
  endDate: string | null;
  status: string;
  signedAt: string | null;
  signedByName: string | null;
};

const statusStyles: Record<string, string> = {
  draft: "bg-[var(--color-ink-100)] text-[var(--color-ink-600)]",
  sent: "bg-blue-50 text-blue-700",
  signed: "bg-emerald-50 text-emerald-700",
  declined: "bg-red-50 text-red-700",
  expired: "bg-[var(--color-ink-100)] text-[var(--color-ink-400)]",
};

function SignRow({ contract, onDone }: { contract: ContractRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [signedByName, setSignedByName] = useState("");
  const [photo, setPhoto] = useState<{ base64: string; mimeType: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!signedByName.trim()) { setError("Enter who signed"); return; }
    if (!photo) { setError("A photo of the signed contract is required"); return; }
    setPending(true);
    try {
      const result = await signContractAction({ id: contract.id, signedByName, base64Image: photo.base64, mimeType: photo.mimeType });
      if ("error" in result) { setError(result.error); return; }
      onDone();
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="text-[12px] font-medium text-[var(--color-accent-600)] hover:underline">Upload signed copy</button>;
  }

  return (
    <div className="mt-2 rounded-lg border border-dashed border-[var(--color-ink-200)] p-3 space-y-2 w-full">
      <input
        value={signedByName}
        onChange={(e) => setSignedByName(e.target.value)}
        placeholder="Signed by (client's name)"
        className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
      />
      <PhotoCapture required onChange={(p) => setPhoto(p ? { base64: p.base64, mimeType: p.mimeType } : null)} />
      {error && <div className="text-[11.5px] text-[var(--color-bad)]">{error}</div>}
      <div className="flex gap-3">
        <button disabled={pending} onClick={submit} className="text-[12px] font-medium text-white bg-[var(--color-accent-500)] rounded-lg px-3 py-1.5 disabled:opacity-50">
          {pending ? "Saving…" : "Confirm signed"}
        </button>
        <button onClick={() => setOpen(false)} className="text-[12px] text-[var(--color-ink-400)] hover:underline">Cancel</button>
      </div>
    </div>
  );
}

function ContractCard({ contract, onChanged }: { contract: ContractRow; onChanged: () => void }) {
  const [pending, setPending] = useState(false);

  async function setStatus(status: Extract<ContractStatus, "sent" | "declined" | "expired">) {
    setPending(true);
    try {
      await updateContractStatusAction(contract.id, status);
      onChanged();
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    try {
      const result = await deleteContractAction(contract.id);
      if (!("error" in result)) onChanged();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-[13.5px]">{contract.subject}</div>
          <div className="text-[11.5px] text-[var(--color-ink-400)] mt-0.5">
            {contract.startDate}{contract.endDate ? ` → ${contract.endDate}` : ""}
            {contract.status === "signed" && contract.signedByName && ` · Signed by ${contract.signedByName} on ${(contract.signedAt || "").slice(0, 10)}`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-medium ${statusStyles[contract.status] ?? statusStyles.draft}`}>
            {CONTRACT_STATUS_LABELS[contract.status as ContractStatus] ?? contract.status}
          </span>
          <span className="text-[13px] font-medium tnum">{fmtKES(contract.valueCents)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-2.5">
        <a href={`/api/pdf/contract/${contract.id}`} target="_blank" rel="noreferrer" className="text-[12px] font-medium text-[var(--color-accent-600)] hover:underline">
          View PDF
        </a>
        {contract.status === "draft" && (
          <>
            <button disabled={pending} onClick={() => setStatus("sent")} className="text-[12px] font-medium text-[var(--color-accent-600)] hover:underline disabled:opacity-50">Mark Sent</button>
            <button disabled={pending} onClick={remove} className="text-[12px] text-[var(--color-bad)] hover:underline disabled:opacity-50">Delete</button>
          </>
        )}
        {(contract.status === "draft" || contract.status === "sent") && (
          <>
            <SignRow contract={contract} onDone={onChanged} />
            <button disabled={pending} onClick={() => setStatus("declined")} className="text-[12px] text-[var(--color-bad)] hover:underline disabled:opacity-50">Mark Declined</button>
          </>
        )}
        {contract.status === "signed" && (
          <button disabled={pending} onClick={() => setStatus("expired")} className="text-[12px] text-[var(--color-ink-400)] hover:underline disabled:opacity-50">Mark Expired</button>
        )}
      </div>
    </div>
  );
}

export function ContractsPanel({ projectId, contracts }: { projectId: number; contracts: ContractRow[] }) {
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState("");
  const [value, setValue] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    window.location.reload();
  }

  async function submit() {
    setError(null);
    if (!subject.trim() || !startDate) { setError("Subject and start date are required"); return; }
    setPending(true);
    try {
      const formData = new FormData();
      formData.set("subject", subject);
      formData.set("value", value);
      formData.set("startDate", startDate);
      formData.set("endDate", endDate);
      formData.set("content", content);
      const result = await createContractAction(projectId, formData);
      if ("error" in result) { setError(result.error); return; }
      refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {contracts.length === 0 && !showNew ? (
        <EmptyState
          title="No contracts yet"
          body="Client service agreements for this event — print, get it signed, then upload a photo of the signed copy to close the loop."
          action={<button onClick={() => setShowNew(true)} className="text-[13px] font-medium text-white bg-[var(--color-accent-500)] rounded-lg px-4 py-2">+ New Contract</button>}
        />
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => <ContractCard key={c.id} contract={c} onChanged={refresh} />)}
        </div>
      )}

      {contracts.length > 0 && !showNew && (
        <button onClick={() => setShowNew(true)} className="text-[13px] font-medium text-[var(--color-accent-600)] hover:underline">+ New Contract</button>
      )}

      {showNew && (
        <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] p-4 space-y-2.5">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject — e.g. Wedding Décor & Rental Agreement"
            className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type="number" step="0.01" min="0"
              placeholder="Value (KES)"
              className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
            />
            <input
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              type="date"
              className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
            />
            <input
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              type="date"
              className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
            />
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            placeholder="Terms (optional)"
            className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]"
          />
          {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}
          <div className="flex gap-3">
            <button disabled={pending} onClick={submit} className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2 transition-colors disabled:opacity-50">
              {pending ? "Saving…" : "Save contract"}
            </button>
            <button onClick={() => setShowNew(false)} className="text-[13px] text-[var(--color-ink-400)] hover:underline">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
