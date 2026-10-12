// Supabase Edge Function: portal_notify (Partner Portal Phase 1C, spec 5.8 and 5.9).
//
// Invoked by pg_cron via pg_net every 2 minutes (20261014000006_portal_notify_cron.sql).
// Authenticates with CRON_SECRET (a raw string, NOT a JWT) via requireCronCaller,
// so this function MUST be verify_jwt=false in config.toml or the gateway 401s
// the scheduler before it runs.
//
// Each run queues the same-day nudges, then drains up to 20 rows (paced) of
// portal_email_outbox. All logic lives in _shared/portalNotify.ts (unit-tested);
// this file only wires the service-role client, Resend and the brand lookup.
//
// Setup an operator must do per environment before this delivers anything:
//   1. Create the Vault secret `portal_notify_fn_url` = this function's URL
//      (prod https://api.getnavigatr.io/functions/v1/portal_notify).
//   2. CRON_SECRET, RESEND_API_KEY, APP_ENV, EMAIL_ALLOWLIST, FROM_ADDRESS and
//      APP_BASE_URL are the same Edge Function secrets notify_no_deals uses.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";
import { handlePortalNotifyRequest, type PortalNotifyDeps } from "../_shared/portalNotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Auth for the cron caller is a dedicated secret, NOT the service-role key.
// See _shared/cronAuth.ts for why.
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
// Outside production only allowlisted recipients are deliverable; unset APP_ENV
// fails closed (nothing sends). See _shared/emailGuard.ts.
const APP_ENV = Deno.env.get("APP_ENV");
const EMAIL_ALLOWLIST = Deno.env.get("EMAIL_ALLOWLIST") ?? "";
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "navigatr <invites@send.getnavigatr.io>";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.getnavigatr.io";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resend = new Resend(RESEND_API_KEY);

const deps: PortalNotifyDeps = {
  rpc: async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    return { data, error: error ? { message: error.message } : null };
  },
  loadBrand: async (orgId) => {
    const { data, error } = await db
      .from("org_branding")
      .select("logo_url, primary_color")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      logoUrl: typeof data.logo_url === "string" ? data.logo_url : null,
      primaryColor: typeof data.primary_color === "string" ? data.primary_color : null,
    };
  },
  sendEmail: async (msg) => {
    const res = await resend.emails.send(msg);
    if ((res as { error?: unknown }).error) {
      throw new Error(JSON.stringify((res as { error: unknown }).error));
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  env: {
    appBaseUrl: APP_BASE_URL,
    fromAddress: FROM_ADDRESS,
    appEnv: APP_ENV,
    emailAllowlist: EMAIL_ALLOWLIST,
  },
};

Deno.serve((req) => handlePortalNotifyRequest(req, CRON_SECRET, deps));
