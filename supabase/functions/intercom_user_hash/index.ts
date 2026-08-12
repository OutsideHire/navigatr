// Supabase Edge Function: intercom_user_hash. Intercom identity verification.
//
// For the authenticated caller, returns the HMAC Intercom uses to verify the
// user (user_hash). The client boots the Intercom Messenger with
// { user_id: <supabase user id>, user_hash } so Intercom can confirm the user
// is who we claim, which prevents impersonation in support chat.
//
//   POST (Authorization: Bearer <user jwt>)
//     -> { user_hash: string | null }
//
// Auth: requires a real authenticated user JWT (verified like resolve_place).
//
// GRACEFUL DEGRADATION: if INTERCOM_IDENTITY_SECRET is unset/empty we return
// { user_hash: null } (200), not an error, so the client can still boot the
// Messenger (just unverified) rather than breaking support entirely.
//
// The identity secret is never logged and never returned.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeIntercomUserHash } from "../_shared/intercomHash.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "missing_authorization" }, 401);
  }

  // Verify the caller is a real authenticated user (don't trust a raw header).
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized" }, 401);
  }

  // If the identity secret is not configured, degrade gracefully: the client
  // still boots the Messenger, just without verification.
  const secret = Deno.env.get("INTERCOM_IDENTITY_SECRET") ?? "";
  if (!secret) {
    return json({ user_hash: null });
  }

  // Hash the Supabase user id, which is exactly what the client passes to
  // Intercom as user_id.
  const userHash = await computeIntercomUserHash(secret, userData.user.id);
  return json({ user_hash: userHash });
});
