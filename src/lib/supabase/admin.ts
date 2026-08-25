import { createClient } from "@supabase/supabase-js";
import { cleanEnv } from "@/lib/env";

/**
 * Service-role client — server only. Used by the admin to create staff
 * accounts (email + password) without an email-confirmation round trip.
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment (never expose to client).
 */
export function createAdminClient() {
  const url = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error(
      "Staff accounts need SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase dashboard → Settings → API → service_role). Add it and restart."
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
