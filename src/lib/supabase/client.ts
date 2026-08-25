import { createBrowserClient } from "@supabase/ssr";
import { cleanEnv } from "@/lib/env";

// Singleton — one browser client (and one Realtime websocket) per tab.
// Callers that used to get a fresh client per call still work identically;
// createBrowserClient itself is stateless enough that sharing it is safe,
// and Realtime subscriptions in particular need to ride the same socket to
// be multiplexed instead of opening a new connection per component.
let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
      cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    );
  }
  return client;
}
