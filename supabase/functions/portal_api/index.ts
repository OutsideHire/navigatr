// Supabase Edge Function: portal_api (Partner Portal, spec 5.1).
//
// The partner-facing API. verify_jwt is OFF in config.toml because partners are
// never Supabase Auth users (spec R2): there is no JWT to verify. Identity is the
// x-portal-session header, checked in SQL on every request. All logic lives in
// _shared/portalApi.ts (unit-tested); this file only wires real dependencies.
//
// Routes: POST /functions/v1/portal_api/<action>, where action is one of
//   brand | request_code | verify_code | peek_invite | accept_invite | me | sign_out
//   form | dup_check | submit_referral | list_referrals | dashboard | get_referral
//   withdraw_referral | transcribe   (Phase 1B, session required)
//   export_referrals | get_profile | update_profile   (Phase 2A, session required)
//   list_sent_referrals | get_sent_referral | post_note   (Phase 2B-3, session required)
//   unsubscribe_digest   (Phase 2B-3, no session: the weekly summary opt-out and its one-click POST)
//   public_form | public_submit   (Phase 2B-1, no session: the public referral form)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";
import { handlePortalRequest, type PortalApiDeps } from "../_shared/portalApi.ts";
import { MOCK_TRANSCRIPT, transcribeWithAssemblyAI } from "../_shared/transcribe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
// Outside production only allowlisted recipients are deliverable; unset APP_ENV
// fails closed. See _shared/emailGuard.ts.
const APP_ENV = Deno.env.get("APP_ENV");
const EMAIL_ALLOWLIST = Deno.env.get("EMAIL_ALLOWLIST") ?? "";
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "navigatr <invites@send.getnavigatr.io>";
const NO_REPLY_ADDRESS = Deno.env.get("NO_REPLY_ADDRESS") ?? "no-reply@send.getnavigatr.io";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.getnavigatr.io";
// Same secret and mock flag as the rep-facing transcribe function.
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const TRANSCRIBE_MOCK = Deno.env.get("TRANSCRIBE_MOCK") === "1";

// Phase 2B-1 public referral form. Both fail closed when unset: without the
// signing secret the form answers not_available; without the Turnstile secret
// a connection over the soft limit can never pass the check.
const PUBLIC_FORM_SIGNING_SECRET = Deno.env.get("PUBLIC_FORM_SIGNING_SECRET") ?? "";
const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resend = new Resend(RESEND_API_KEY);

const deps: PortalApiDeps = {
  rpc: async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    return { data, error: error ? { message: error.message } : null };
  },
  sendEmail: async (msg) => {
    const res = await resend.emails.send({ ...msg, replyTo: msg.replyTo ?? undefined });
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
  transcribe: (audio) =>
    TRANSCRIBE_MOCK
      ? Promise.resolve(MOCK_TRANSCRIPT)
      : transcribeWithAssemblyAI(audio, {
        fetch: (input, init) => fetch(input, init),
        apiKey: ASSEMBLYAI_API_KEY,
      }),
  fetch: (input, init) => fetch(input, init),
  env: {
    appBaseUrl: APP_BASE_URL,
    fromAddress: FROM_ADDRESS,
    appEnv: APP_ENV,
    emailAllowlist: EMAIL_ALLOWLIST,
    noReplyAddress: NO_REPLY_ADDRESS,
    publicFormSigningSecret: PUBLIC_FORM_SIGNING_SECRET,
    turnstileSecretKey: TURNSTILE_SECRET_KEY,
  },
};

Deno.serve((req) => handlePortalRequest(req, deps));
