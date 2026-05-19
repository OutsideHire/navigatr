/**
 * Supabase client — single instance for the whole frontend.
 *
 * The anon key is safe to expose in client code (it's a public JWT).
 * Real authorization is enforced server-side via Row Level Security
 * policies on each table.
 *
 * Session persistence is handled by the SDK against localStorage by
 * default; we don't manage it ourselves. The auth store at
 * `src/stores/auth.ts` subscribes to `onAuthStateChange` to mirror
 * SDK state into our app.
 */

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Loud failure in dev; in prod the build still ships but auth won't work.
  console.error(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Copy apps/app/.env.local.example to apps/app/.env.local and fill in " +
      "your Supabase project values.",
  );
}

// Placeholder URL keeps createClient happy when env vars are absent
// (e.g. CI running unit tests that mock @/lib/supabase or seed the
// React Query cache directly — neither hits the network). In dev and
// prod the real values from .env.local / Vercel env override.
// supabase-js v2.105+ throws "supabaseUrl is required." if we pass "".
const SAFE_URL = url || "http://localhost:54321";
const SAFE_KEY = anonKey || "test-anon-key-placeholder";

export const supabase = createClient(SAFE_URL, SAFE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: "navigatr-auth",
    flowType: "pkce",
  },
});

export type { Session, User } from "@supabase/supabase-js";
