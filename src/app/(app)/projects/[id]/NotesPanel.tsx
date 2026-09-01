"use client";

import { useState } from "react";
import { createProjectNoteAction, deleteProjectNoteAction } from "@/lib/project-notes";
import { EmptyState } from "@/components/ui";
import { NOTE_CATEGORIES, NOTE_CATEGORY_META, type NoteCategory } from "@/lib/project-note-categories";

type NoteRow = {
  id: number;
  authorName: string;
  category: string;
  content: string;
  clientVisible: boolean;
  createdAt: string;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export function NotesPanel({ projectId, notes }: { projectId: number; notes: NoteRow[] }) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<NoteCategory>("internal");
  const [clientVisible, setClientVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    window.location.reload();
  }

  async function submit() {
    setError(null);
    if (!content.trim()) { setError("Note content is required"); return; }
    setPending(true);
    try {
      const result = await createProjectNoteAction({ projectId, content, category, clientVisible });
      if ("error" in result) { setError(result.error); return; }
      setContent("");
      setClientVisible(false);
      refresh();
    } finally {
      setPending(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this note?")) return;
    await deleteProjectNoteAction(id);
    refresh();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[var(--color-ink-100)] bg-gradient-to-br from-white to-[var(--color-ink-50)]/60 p-4 space-y-3">
        <div className="text-[12px] font-semibold text-[var(--color-ink-600)]">New note</div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="What's happening with this event?"
          className="w-full rounded-xl border border-[var(--color-ink-200)] bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-[var(--color-accent-500)] resize-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {NOTE_CATEGORIES.map((c) => {
            const meta = NOTE_CATEGORY_META[c];
            const active = category === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className="rounded-full px-3 py-1.5 text-[12px] font-medium border transition-all"
                style={
                  active
                    ? { background: meta.bg, borderColor: meta.color, color: meta.color }
                    : { background: "white", borderColor: "var(--color-ink-200)", color: "var(--color-ink-500)" }
                }
              >
                <span className="mr-1">{meta.icon}</span>{meta.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-ink-600)] cursor-pointer select-none">
            <input type="checkbox" checked={clientVisible} onChange={(e) => setClientVisible(e.target.checked)} className="accent-[var(--color-accent-500)]" />
            Visible to client in their portal
          </label>
          <button disabled={pending} onClick={submit} className="rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white text-[13px] font-medium px-4 py-2 transition-colors disabled:opacity-50">
            {pending ? "Saving…" : "Add note"}
          </button>
        </div>
        {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}
      </div>

      {notes.length === 0 ? (
        <EmptyState title="No notes yet" body="Keep a running log of what's happening with this event — client updates, follow-ups, payment context, venue logistics." />
      ) : (
        <div className="relative pl-5">
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--color-ink-100)]" />
          <div className="space-y-4">
            {notes.map((n) => {
              const meta = NOTE_CATEGORY_META[(n.category as NoteCategory) in NOTE_CATEGORY_META ? (n.category as NoteCategory) : "internal"];
              return (
                <div key={n.id} className="relative group">
                  <div
                    className="absolute -left-5 top-1.5 h-3 w-3 rounded-full ring-4 ring-white"
                    style={{ background: meta.color }}
                  />
                  <div className="rounded-xl border border-[var(--color-ink-100)] px-4 py-3" style={{ background: meta.bg + "55" }}>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        {meta.icon} {meta.label}
                      </span>
                      <div className="flex items-center gap-2">
                        {n.clientVisible && (
                          <span className="text-[10.5px] text-[var(--color-ink-400)]" title="Visible to client">👁 Client-visible</span>
                        )}
                        <button
                          onClick={() => remove(n.id)}
                          className="opacity-0 group-hover:opacity-100 text-[var(--color-ink-300)] hover:text-[var(--color-bad)]"
                          aria-label="Delete note"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <div className="text-[13.5px] text-[var(--color-ink-900)] mt-2 whitespace-pre-wrap leading-relaxed">{n.content}</div>
                    <div className="text-[11.5px] text-[var(--color-ink-400)] mt-2">
                      <span className="font-medium">{n.authorName}</span> · {timeAgo(n.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
