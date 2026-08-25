// Supabase Edge Function: daily "no deals yet" activation heads-up.
//
// Invoked by pg_cron via pg_net (see 20260825000006_notify_no_deals_cron.sql).
// Authenticates with CRON_SECRET (a raw string, NOT a JWT) via requireCronCaller,
// so this function MUST be verify_jwt=false in config.toml or the gateway 401s
// the scheduler before it runs.
//
// Using the service-role key (bypassing RLS), it finds beta orgs that have been
// active a few days but never created a deal (excluding demo/disabled/already-
// nudged orgs), emails each org's administrator a one-time "add your first deal"
// nudge, and sends the Navigatr operator a single heads-up digest. Each org is
// stamped (organizations.no_deals_nudged_at) so it is never nudged twice.
//
// Setup an operator must do per environment before this delivers anything:
//   1. Create the Vault secret `notify_no_deals_fn_url` = the function's URL
//      (prod https://api.getnavigatr.io/functions/v1/notify_no_deals).
//   2. Set the OPS_NOTIFY_EMAIL Edge Function secret to the operator address(es)
//      (comma-separated). If unset, customer nudges still send; the operator
//      digest is skipped (logged).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";
import { renderEmail } from "../_shared/emailTemplate.ts";
import { shouldSend } from "../_shared/emailGuard.ts";
import { requireCronCaller } from "../_shared/cronAuth.ts";
import { nudgeEmail, opsDigestEmail, type BuiltEmail, type DeadOrg } from "../_shared/noDealsEmail.ts";

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
const OPS_NOTIFY_EMAIL = Deno.env.get("OPS_NOTIFY_EMAIL") ?? "";
// Orgs younger than this are not nudged (avoid same-day-signup noise).
const ACTIVATION_WINDOW_DAYS = 3;

const resend = new Resend(RESEND_API_KEY);
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

interface Candidate {
  org_id: string;
  org_name: string;
  created_at: string;
  admin_emails: string[];
}

async function send(to: string, built: BuiltEmail): Promise<void> {
  const { html, text } = renderEmail(built);
  const res = await resend.emails.send({ from: FROM_ADDRESS, to, subject: built.subject, html, text });
  if ((res as { error?: unknown }).error) {
    throw new Error(String((res as { error: unknown }).error));
  }
}

Deno.serve(async (req) => {
  const denied = requireCronCaller(req, CRON_SECRET);
  if (denied) return denied;

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data, error } = await db.rpc("orgs_needing_no_deals_nudge", {
    p_min_age_days: ACTIVATION_WINDOW_DAYS,
  });
  if (error) {
    console.error("[notify_no_deals] candidate query failed:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
  }

  const candidates = (data ?? []) as Candidate[];
  const nudged: DeadOrg[] = [];
  let customerEmails = 0;

  for (const org of candidates) {
    try {
      // Each admin send is isolated: one bad/rejected admin address must not
      // abort the org before it is stamped, or the org would stay a candidate
      // and re-nudge its OTHER (working) admins every day, forever. A per-admin
      // failure just means that one admin misses this one-time nudge.
      for (const email of org.admin_emails ?? []) {
        if (!email) continue;
        if (!shouldSend(APP_ENV, EMAIL_ALLOWLIST, email)) {
          console.log(`[notify_no_deals][emailGuard] dropped ${email} in APP_ENV=${APP_ENV ?? "(unset)"}`);
          continue;
        }
        try {
          await send(email, nudgeEmail(org.org_name, APP_BASE_URL));
          customerEmails += 1;
        } catch (e) {
          console.error(
            `[notify_no_deals] nudge to ${email} (org ${org.org_id}) failed:`,
            e instanceof Error ? e.message : String(e),
          );
        }
      }
      // Stamp once the org has been ATTEMPTED (regardless of individual send
      // outcomes), so it is nudged at most once. A failed stamp (rare DB error)
      // throws and leaves the org unmarked to retry next run.
      const { error: markErr } = await db
        .from("organizations")
        .update({ no_deals_nudged_at: new Date().toISOString() })
        .eq("id", org.org_id);
      if (markErr) throw new Error(`mark failed: ${markErr.message}`);

      const ageDays = Math.max(
        0,
        Math.floor((Date.now() - new Date(org.created_at).getTime()) / 86_400_000),
      );
      nudged.push({ name: org.org_name, ageDays });
    } catch (e) {
      // Stamp/unexpected failure: leave unmarked (retry next run), exclude from
      // the digest since its state is ambiguous.
      console.error(
        `[notify_no_deals] org ${org.org_id} failed:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // One operator heads-up digest for everything nudged this run.
  let opsEmailed = false;
  if (nudged.length > 0 && OPS_NOTIFY_EMAIL) {
    const digest = opsDigestEmail(nudged, APP_BASE_URL);
    for (const to of OPS_NOTIFY_EMAIL.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!shouldSend(APP_ENV, EMAIL_ALLOWLIST, to)) {
        console.log(`[notify_no_deals][emailGuard] dropped ops ${to} in APP_ENV=${APP_ENV ?? "(unset)"}`);
        continue;
      }
      try {
        await send(to, digest);
        opsEmailed = true;
      } catch (e) {
        console.error("[notify_no_deals] ops digest failed:", e instanceof Error ? e.message : String(e));
      }
    }
  } else if (nudged.length > 0 && !OPS_NOTIFY_EMAIL) {
    console.log("[notify_no_deals] OPS_NOTIFY_EMAIL unset; skipped operator digest");
  }

  return new Response(
    JSON.stringify({
      checked: candidates.length,
      nudgedOrgs: nudged.length,
      customerEmails,
      opsEmailed,
    }),
    { headers: JSON_HEADERS },
  );
});
