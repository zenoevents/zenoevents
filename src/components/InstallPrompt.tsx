"use client";

import { useEffect, useState } from "react";

/**
 * Registers the service worker and shows a quiet, dismissable "Install" banner
 * at the bottom, tinted with the org brand color. On Android/desktop it uses
 * the native beforeinstallprompt; on iOS Safari (which has no such event) it
 * shows the Share → Add to Home Screen hint. Dismissal is remembered.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BIPEvent = any;

const DISMISS_KEY = "zeno-install-dismissed";

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    // Register the SW in production only. In dev, Turbopack recompiles
    // constantly and the SW's cache-first /_next/static strategy (below)
    // ends up serving a stale chunk against fresh server-rendered HTML —
    // a hydration mismatch that has nothing to do with the component that
    // happened to change last, and disappears the moment you register the
    // SW is skipped.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // already installed (standalone) or previously dismissed → stay quiet
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.navigator as any).standalone === true;
    if (standalone) return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const onBIP = (e: BIPEvent) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // iOS Safari: no beforeinstallprompt — offer the manual hint
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
    if (isIOS && isSafari) {
      const t = setTimeout(() => {
        setIosHint(true);
        setShow(true);
      }, 2500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBIP);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  function dismiss() {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, "1");
  }

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice?.catch(() => {});
    setDeferred(null);
    setShow(false);
    localStorage.setItem(DISMISS_KEY, "1");
  }

  if (!show) return null;

  return (
    <div className="no-print fixed bottom-4 inset-x-0 z-[60] flex justify-center px-4 pointer-events-none">
      <div
        className="pointer-events-auto flex items-center gap-3 rounded-xl bg-white/95 backdrop-blur border border-[var(--color-ink-100)] shadow-lg pl-3 pr-2 py-2 max-w-[420px] w-full"
        style={{ boxShadow: "0 6px 24px rgba(0,0,0,0.10)" }}
      >
        <div className="shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-white border border-[var(--color-ink-100)] flex items-center justify-center">
          <img src="/images/brand/zeno-icon.png" alt="" className="w-7 h-7 object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-tight">Install Zeno</div>
          <div className="text-[11.5px] text-[var(--color-ink-400)] leading-tight mt-0.5">
            {iosHint ? "Tap Share, then “Add to Home Screen”." : "Add to your device for quick access."}
          </div>
        </div>
        {!iosHint && (
          <button
            onClick={install}
            className="shrink-0 rounded-lg text-white text-[12.5px] font-medium px-3 py-1.5"
            style={{ background: "var(--color-brand, #0f766e)" }}
          >
            Install
          </button>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 w-7 h-7 rounded-full text-[var(--color-ink-400)] hover:bg-[var(--color-ink-50)] flex items-center justify-center text-[16px]"
        >
          ×
        </button>
      </div>
    </div>
  );
}
