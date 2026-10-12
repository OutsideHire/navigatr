// Supabase Edge Function: portal_api (Partner Portal, spec 5.1).
//
// The partner-facing API. verify_jwt is OFF in config.toml because partners are
// never Supabase Auth users (spec R2): there is no JWT to verify. Identity is the
// x-portal-session header, checked in SQL on every request. All logic lives in
// _shared/portalApi.ts (unit-tested); this file only wires real dependencies.
//
// Routes: POST /functions/v1/portal_api/<action>, where action is one of
//   brand | request_code | verify_code | peek_invite | accept_invite | me | sign_out

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";
import { handlePortalRequest, type PortalApiDeps } from "../_shared/portalApi.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
// Outside production only allowlisted recipients are deliverable; unset APP_ENV
// fails closed. See _shared/emailGuard.ts.
const APP_ENV = Deno.env.get("APP_ENV");
const EMAIL_ALLOWLIST = Deno.env.get("EMAIL_ALLOWLIST") ?? "";
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "navigatr <invites@send.getnavigatr.io>";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.getnavigatr.io";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resend = new Resend(RESEND_API_KEY);

const deps: PortalApiDeps = {
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
  // Detach the email send so response time never reveals account existence.
  background: (p) =>
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil
      ? // deno-lint-ignore no-explicit-any
        (globalThis as any).EdgeRuntime.waitUntil(p)
      : p.catch((e) => console.error("[portal_api] background", e)),
  env: {
    appBaseUrl: APP_BASE_URL,
    fromAddress: FROM_ADDRESS,
    appEnv: APP_ENV,
    emailAllowlist: EMAIL_ALLOWLIST,
  },
};

Deno.serve((req) => handlePortalRequest(req, deps));
