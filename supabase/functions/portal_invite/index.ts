// Supabase Edge Function: portal_invite (Partner Portal, spec 5.3).
//
// Called by a signed-in rep from the partner record (supabase.functions.invoke,
// verify_jwt = true). The caller is verified with auth.getUser() through a
// user-JWT client; the invite itself is created by the service-role-only SQL
// function portal_create_invite, which re-checks visibility for that user. All
// logic lives in _shared/portalInvite.ts (unit-tested).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";
import { handlePortalInvite } from "../_shared/portalInvite.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const APP_ENV = Deno.env.get("APP_ENV");
const EMAIL_ALLOWLIST = Deno.env.get("EMAIL_ALLOWLIST") ?? "";
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "navigatr <invites@send.getnavigatr.io>";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.getnavigatr.io";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resend = new Resend(RESEND_API_KEY);

Deno.serve((req) =>
  handlePortalInvite(req, {
    getUserId: async () => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return null;
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data, error } = await userClient.auth.getUser();
      return error || !data?.user ? null : data.user.id;
    },
    rpc: async (name, args) => {
      const { data, error } = await db.rpc(name, args);
      return { data, error: error ? { message: error.message } : null };
    },
    sendEmail: async (msg) => {
      const res = await resend.emails.send(msg);
      if ((res as { error?: unknown }).error) {
        throw new Error(JSON.stringify((res as { error: unknown }).error));
      }
    },
    env: {
      appBaseUrl: APP_BASE_URL,
      fromAddress: FROM_ADDRESS,
      appEnv: APP_ENV,
      emailAllowlist: EMAIL_ALLOWLIST,
    },
  })
);
