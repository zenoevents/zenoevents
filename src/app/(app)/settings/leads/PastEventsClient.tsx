"use client";

import { useState, useTransition } from "react";
import { setInstagramPostUrlsAction } from "@/lib/leads";

export function PastEventsClient({ initialUrls }: { initialUrls: string[] }) {
  const [text, setText] = useState(initialUrls.join("\n"));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function save() {
    setResult(null);
    start(async () => {
      const urls = text.split(/\r?\n/).map((u) => u.trim()).filter(Boolean);
      const res = await setInstagramPostUrlsAction(urls);
      setResult("error" in res ? res.error : "Saved — invalid/non-Instagram lines were dropped.");
    });
  }

  return (
    <div className="card p-4 max-w-2xl space-y-2">
      <div className="text-[13px] font-semibold">Past Events (Instagram)</div>
      <p className="text-[11.5px] text-[var(--color-ink-400)]">
        Paste Instagram post links (one per line, e.g. https://www.instagram.com/p/xxxxx/) — shown as a scrollable strip on your public lead form. Not auto-synced; update this list whenever you want it refreshed.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="https://www.instagram.com/p/..."
        className="w-full rounded-md border border-[var(--color-ink-200)] px-2 py-2 text-[12.5px] font-mono"
      />
      {result && <div className="text-[11.5px] text-[var(--color-ink-500)]">{result}</div>}
      <button
        onClick={save}
        disabled={pending}
        className="rounded-md bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[12.5px] font-medium px-4 py-2"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
