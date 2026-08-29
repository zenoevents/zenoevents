"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    instgrm?: { Embeds: { process: () => void } };
  }
}

/** Renders admin-pasted Instagram post URLs via Instagram's own oEmbed
 *  widget (embed.js) — no login, no API key. Loads the script once,
 *  re-processes embeds whenever the URL list changes. */
export function PastEvents({ urls }: { urls: string[] }) {
  useEffect(() => {
    if (urls.length === 0) return;
    const existing = document.getElementById("instagram-embed-js");
    if (existing) {
      window.instgrm?.Embeds.process();
      return;
    }
    const script = document.createElement("script");
    script.id = "instagram-embed-js";
    script.async = true;
    script.src = "https://www.instagram.com/embed.js";
    document.body.appendChild(script);
  }, [urls]);

  if (urls.length === 0) return null;

  return (
    <div className="max-w-3xl mx-auto mt-8">
      <div className="text-center text-sm font-medium text-gray-600 mb-3">Past events</div>
      <div className="flex gap-4 overflow-x-auto pb-2 px-1 snap-x">
        {urls.map((url) => (
          <div key={url} className="shrink-0 w-[340px] snap-start">
            <blockquote className="instagram-media" data-instgrm-captioned data-instgrm-permalink={url} data-instgrm-version="14" style={{ margin: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
