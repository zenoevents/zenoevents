"use client";

import { useState, useTransition } from "react";
import { portalLoginAction } from "./actions";
import { useRouter, useParams } from "next/navigation";

export default function ClientPortalLogin() {
  const params = useParams();
  const slug = params.orgSlug as string;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      try {
        const res = await portalLoginAction(slug, email, password);
        if (res.error) setError(res.error);
        else router.push(`/portal/${slug}/projects`);
      } catch (err: any) {
        setError(err.message || "An error occurred");
      }
    });
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2.5 text-[13.5px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] transition-all";

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-ink-50)]">
      <div className="w-full max-w-[400px] px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] leading-tight">
            Welcome Back
          </h1>
          <p className="text-[13px] text-[var(--color-ink-400)] mt-1.5">
            Sign in to your client portal
          </p>
        </div>

        {/* Card */}
        <div className="card p-7">
          <form onSubmit={handleLogin} className="space-y-4">
            <label className="block">
              <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
                Email address
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls + " mt-1"}
                placeholder="you@company.com"
              />
            </label>

            <label className="block">
              <span className="text-[12px] font-medium text-[var(--color-ink-600)]">
                Password
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls + " mt-1"}
                placeholder="••••••••"
              />
            </label>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 text-[12.5px] text-[var(--color-bad)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-60 text-white text-[13.5px] font-medium py-2.5 transition-colors mt-1"
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <div className="mt-8 text-center text-[12px] text-[var(--color-ink-400)]">
          Powered by Zeno
        </div>
      </div>
    </div>
  );
}
