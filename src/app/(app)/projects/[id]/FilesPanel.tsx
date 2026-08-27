"use client";

import { useRef, useState } from "react";
import { uploadProjectFileAction, updateProjectFileAction, deleteProjectFileAction, getProjectFileUrlAction } from "@/lib/project-files";
import { EmptyState } from "@/components/ui";

type FileRow = {
  id: number;
  filename: string;
  storagePath: string;
  docType: string | null;
  label: string | null;
  note: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
};

const DOC_TYPES = ["Contract", "Moodboard", "Invoice", "Other"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function FileRowItem({ file, onChanged }: { file: FileRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(file.label ?? "");
  const [note, setNote] = useState(file.note ?? "");
  const [docType, setDocType] = useState(file.docType ?? "");
  const [uploadedAt, setUploadedAt] = useState(file.uploadedAt);
  const [pending, setPending] = useState(false);

  async function open() {
    const result = await getProjectFileUrlAction(file.storagePath);
    if (typeof result === "string") window.open(result, "_blank");
    else alert(result.error);
  }

  async function save() {
    setPending(true);
    try {
      await updateProjectFileAction(file.id, { label, note, docType, uploadedAt });
      setEditing(false);
      onChanged();
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${file.filename}"?`)) return;
    await deleteProjectFileAction(file.id);
    onChanged();
  }

  return (
    <div className="rounded-lg border border-[var(--color-ink-100)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-[13.5px] truncate">{file.label || file.filename}</div>
          <div className="text-[11.5px] text-[var(--color-ink-400)] mt-0.5">
            {file.filename} · {file.uploadedAt}
            {file.docType && ` · ${file.docType}`}
            {file.uploadedByName && ` · uploaded by ${file.uploadedByName}`}
          </div>
          {file.note && !editing && <div className="text-[12.5px] text-[var(--color-ink-600)] mt-1.5">{file.note}</div>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={open} className="text-[12px] font-medium text-[var(--color-accent-600)] hover:underline">Download</button>
          <button onClick={() => setEditing((s) => !s)} className="text-[12px] text-[var(--color-ink-400)] hover:underline">Edit</button>
          <button onClick={remove} className="text-[12px] text-[var(--color-bad)] hover:underline">Delete</button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 pt-3 hairline-t space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label"
              className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
            <select value={docType} onChange={(e) => setDocType(e.target.value)}
              className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]">
              <option value="">Document type…</option>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <input type="date" value={uploadedAt} onChange={(e) => setUploadedAt(e.target.value)}
            className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note"
            className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
          <button disabled={pending} onClick={save} className="text-[12px] font-medium text-white bg-[var(--color-accent-500)] rounded-lg px-3 py-1.5 disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

export function FilesPanel({ projectId, files }: { projectId: number; files: FileRow[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [uploadedAt, setUploadedAt] = useState(new Date().toISOString().slice(0, 10));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    window.location.reload();
  }

  async function submit() {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose a file to upload"); return; }
    setPending(true);
    try {
      const base64File = await fileToBase64(file);
      const result = await uploadProjectFileAction({
        projectId, base64File, mimeType: file.type || "application/octet-stream", filename: file.name,
        docType, label, note, uploadedAt,
      });
      if ("error" in result) { setError(result.error); return; }
      refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {files.length === 0 ? (
        <EmptyState title="No files yet" body="Signed contracts, moodboards, anything related to this event — upload and label it here." />
      ) : (
        <div className="space-y-2">
          {files.map((f) => <FileRowItem key={f.id} file={f} onChanged={refresh} />)}
        </div>
      )}

      <div className="rounded-lg border border-dashed border-[var(--color-ink-200)] p-4 space-y-2.5">
        <div className="text-[12px] font-medium text-[var(--color-ink-600)]">Upload a file</div>
        <input ref={fileRef} type="file" className="text-[13px]" />
        <div className="grid grid-cols-2 gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)"
            className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
          <select value={docType} onChange={(e) => setDocType(e.target.value)}
            className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]">
            <option value="">Document type…</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <label className="block">
          <span className="text-[11px] text-[var(--color-ink-400)]">Date (auto-filled, editable)</span>
          <input type="date" value={uploadedAt} onChange={(e) => setUploadedAt(e.target.value)}
            className="mt-1 rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
        </label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (optional)"
          className="w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)]" />
        {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}
        <button disabled={pending} onClick={submit} className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2 transition-colors disabled:opacity-50">
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>
    </div>
  );
}
