// capture_sent_email — cron-invoked poll of each connected rep's Outlook Sent
// Items for auto email capture (PRD Automatic Email Activity Capture, Phase 1).
//
// Auth: CRON_SECRET (this is not a user-facing endpoint). Dark by default: does
// nothing unless EMAIL_CAPTURE_ENABLED === "1". Metadata only — the Graph query
// selects headers, never body/attachment content.
//
// Per email_connection (provider=outlook): refresh the rep's Microsoft token
// (reusing the calendar OAuth connection), delta-query Sent Items, run the pure
// matcher/router (emailPoll), then write matched -> a SUGGESTED email_activity
// (D-07: the rep confirms before it becomes an activity), unmatched -> the
// manual queue, and advance the connection's poll cursor + health. All writes
// are service-role (RLS is bypassed here by design; the client only reads).
//
// Safety: every DB call is error-checked and THROWS on failure, so the per-
// connection catch marks the connection unhealthy and the delta cursor is NOT
// advanced past messages that were never written (no silent message loss).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronCaller } from "../_shared/cronAuth.ts";
import { microsoftProvider } from "../_shared/calendarProviders/microsoft.ts";
import type { TokenBundle } from "../_shared/googleToken.ts";
import {
  buildSentDeltaUrl,
  collectSentDelta,
  processSentMessages,
  DeltaResyncRequired,
} from "../_shared/emailPoll.ts";
import { chunk } from "../_shared/chunk.ts";
import type { EmailMatchDeal } from "../_shared/emailMatch.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const EMAIL_CAPTURE_ENABLED = Deno.env.get("EMAIL_CAPTURE_ENABLED") === "1";

// Consumer mailbox domains: matchable to a contact by exact address, but never
// used to infer a business account by domain.
const PERSONAL_DOMAINS = [
  "gmail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com",
];

const JSON_HEADERS = { "Content-Type": "application/json" };
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

type Svc = ReturnType<typeof createClient>;

async function setHealth(svc: Svc, connId: string, health: string, lastError: string | null = null): Promise<void> {
  await svc.from("email_connection")
    .update({ health, last_error: lastError, last_poll_at: new Date().toISOString() })
    .eq("id", connId);
}

/** The mailbox's own domain (authoritative "internal" domain), from Graph.
 *  Falls back to null so the caller can use the profile email. */
async function fetchMailboxDomain(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { mail?: string; userPrincipalName?: string };
    const addr = (j.mail || j.userPrincipalName || "").toLowerCase();
    return addr.includes("@") ? addr.split("@")[1] : null;
  } catch {
    return null;
  }
}

interface EmailConnRow {
  id: string;
  user_id: string;
  org_id: string;
  delta_token: string | null;
  capture_start_date: string | null;
}

async function pollConnection(svc: Svc, ec: EmailConnRow): Promise<{ suggested: number; queued: number; skipped: number }> {
  const none = { suggested: 0, queued: 0, skipped: 0 };

  // 1. Fresh Microsoft access token, via the rep's existing calendar OAuth grant.
  const { data: oc, error: ocErr } = await svc
    .from("oauth_connections").select("id, status")
    .eq("provider", "microsoft").eq("user_id", ec.user_id).maybeSingle();
  if (ocErr) throw ocErr;
  if (!oc || oc.status !== "active") { await setHealth(svc, ec.id, "needs_reauth"); return none; }

  const { data: bundleJson, error: tokErr } = await svc.rpc("oauth_token_get", { p_connection_id: oc.id });
  if (tokErr) throw tokErr;
  if (!bundleJson) { await setHealth(svc, ec.id, "needs_reauth"); return none; }

  const fresh = await microsoftProvider.refreshAccessToken(bundleJson as TokenBundle, {
    clientId: Deno.env.get(microsoftProvider.oauth.clientIdEnv) ?? "",
    clientSecret: Deno.env.get(microsoftProvider.oauth.clientSecretEnv) ?? "",
  });
  if (fresh.refreshed) {
    const { error: setErr } = await svc.rpc("oauth_token_set", { p_connection_id: oc.id, p_token: fresh.bundle });
    if (setErr) throw setErr;
    const { error: refErr } = await svc.from("oauth_connections").update({ last_refreshed_at: new Date().toISOString() }).eq("id", oc.id);
    if (refErr) throw refErr;
  }

  // 2. Internal domain = the actual mailbox's domain (fallback: profile email).
  let internalDomains: string[] = [];
  const mailboxDomain = await fetchMailboxDomain(fresh.accessToken);
  if (mailboxDomain) {
    internalDomains = [mailboxDomain];
  } else {
    const { data: prof, error: profErr } = await svc.from("profiles").select("email").eq("id", ec.user_id).maybeSingle();
    if (profErr) throw profErr;
    const email = ((prof?.email as string | undefined) ?? "").toLowerCase();
    if (email.includes("@")) internalDomains = [email.split("@")[1]];
  }

  // 3. Candidate deals: the rep's own deals in this org.
  const { data: dealsRaw, error: dealsErr } = await svc.from("deals").select("id, contact_email").eq("owner_id", ec.user_id).eq("org_id", ec.org_id);
  if (dealsErr) throw dealsErr;
  const deals: EmailMatchDeal[] = (dealsRaw ?? []).map((d) => ({ id: d.id as string, contactEmail: (d.contact_email as string | null) ?? null }));

  // 4. Delta-query Sent Items (metadata only). May throw DeltaResyncRequired
  //    (handled by the caller) or a plain error on other Graph failures.
  const { messages, cursor } = await collectSentDelta(fresh.accessToken, buildSentDeltaUrl(ec.delta_token ?? null), fetch);

  // 5. Dedup context: message ids already recorded in EITHER table, and threads
  //    already turned into an email_activity. Chunked so a large initial sweep
  //    can't blow the query length.
  const msgIds = [...new Set(messages.map((m) => m.id).filter((x): x is string => Boolean(x)))];
  const threadIds = [...new Set(messages.map((m) => m.conversationId).filter((x): x is string => Boolean(x)))];
  const seenMessageIds = new Set<string>();
  const capturedThreadIds = new Set<string>();
  for (const table of ["email_activity", "email_unmatched_queue"] as const) {
    for (const ids of chunk(msgIds, 100)) {
      const { data, error } = await svc.from(table).select("provider_message_id").eq("org_id", ec.org_id).in("provider_message_id", ids);
      if (error) throw error;
      for (const r of data ?? []) if (r.provider_message_id) seenMessageIds.add(r.provider_message_id as string);
    }
  }
  for (const ids of chunk(threadIds, 100)) {
    const { data, error } = await svc.from("email_activity").select("thread_id").eq("org_id", ec.org_id).in("thread_id", ids);
    if (error) throw error;
    for (const r of data ?? []) if (r.thread_id) capturedThreadIds.add(r.thread_id as string);
  }

  // 6. Route.
  const out = processSentMessages({
    messages, orgId: ec.org_id, senderUserId: ec.user_id, provider: "outlook",
    deals, internalDomains, personalDomains: PERSONAL_DOMAINS,
    capturedThreadIds, seenMessageIds,
    captureStartDate: ec.capture_start_date ?? null,
    nowIso: new Date().toISOString(),
  });

  // 7. Write. Error-checked so a failure THROWS before the cursor advances.
  if (out.suggestions.length) {
    const { error } = await svc.from("email_activity").upsert(out.suggestions, { onConflict: "provider,provider_message_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  if (out.queued.length) {
    const { error } = await svc.from("email_unmatched_queue").upsert(out.queued, { onConflict: "provider,provider_message_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  // 8. Advance the cursor + mark healthy ONLY after the writes succeeded.
  const { error: updErr } = await svc.from("email_connection")
    .update({ last_poll_at: new Date().toISOString(), delta_token: cursor ?? ec.delta_token, health: "ok", last_error: null })
    .eq("id", ec.id);
  if (updErr) throw updErr;

  return { suggested: out.suggestions.length, queued: out.queued.length, skipped: out.skipped.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const denied = requireCronCaller(req, CRON_SECRET);
  if (denied) return denied;
  if (!EMAIL_CAPTURE_ENABLED) return json({ skipped: "disabled" });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: conns, error } = await svc
    .from("email_connection").select("id, user_id, org_id, delta_token, capture_start_date").eq("provider", "outlook");
  if (error) return json({ error: error.message }, 500);

  const totals = { connections: 0, suggested: 0, queued: 0, skipped: 0 };
  for (const ec of (conns ?? []) as EmailConnRow[]) {
    try {
      const r = await pollConnection(svc, ec);
      totals.connections++; totals.suggested += r.suggested; totals.queued += r.queued; totals.skipped += r.skipped;
    } catch (e) {
      if (e instanceof DeltaResyncRequired) {
        // Expired delta token: drop it so the next poll does a fresh sync
        // (bounded by capture_start_date, so it still never backfills history).
        await svc.from("email_connection")
          .update({ delta_token: null, health: "ok", last_error: "resync", last_poll_at: new Date().toISOString() })
          .eq("id", ec.id);
      } else {
        await setHealth(svc, ec.id, "error", String(e instanceof Error ? e.message : e));
      }
    }
  }
  return json(totals);
});
