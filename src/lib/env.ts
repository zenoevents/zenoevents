/**
 * Strips anything outside printable ASCII and trims whitespace. Meant for
 * env vars that must be pure ASCII by construction — URLs and JWTs
 * (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) — where a
 * pasted-in zero-width space, BOM, or non-breaking space is never valid
 * content, only clipboard noise from a browser/chat UI. Left unguarded, one
 * of those characters silently bakes into the client bundle at build time
 * (NEXT_PUBLIC_* vars are inlined at build, not read at runtime) and later
 * crashes every fetch that sets it as a header with "String contains non
 * ISO-8859-1 code point" — a build-time typo that only surfaces as a
 * runtime crash.
 */
export function cleanEnv(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/[^\x20-\x7E]/g, "").trim();
}

/** Same cleaning, but throws a clear message instead of silently sending an
 *  empty string to Supabase — which otherwise surfaces as a generic
 *  "Invalid API key" 401 from Supabase itself, with no hint that the actual
 *  problem is a missing/mis-scoped env var on this deployment. */
export function requireEnv(name: string, value: string | undefined): string {
  const cleaned = cleanEnv(value);
  if (!cleaned) {
    throw new Error(
      `Missing environment variable: ${name}. If this is happening on a deployed site, check it's set for the Production environment in Vercel and that you've redeployed since adding it — NEXT_PUBLIC_* vars are baked in at build time, so adding the var alone doesn't fix an already-built deployment.`
    );
  }
  return cleaned;
}
