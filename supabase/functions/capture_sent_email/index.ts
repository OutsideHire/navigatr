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
// manual queue, and update the connection's poll cursor + health. All writes
// are service-role (RLS is bypassed here by design; the client only reads).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronCaller } from "../_shared/cronAuth.ts";
import { microsoftProvider } from "../_shared/calendarProviders/microsoft.ts";
import type { TokenBundle } from "../_shared/googleToken.ts";
import { buildSentDeltaUrl, collectSentDelta, processSentMessages } from "../_shared/emailPoll.ts";
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

interface EmailConnRow { id: string; user_id: string; org_id: string; delta_token: string | null }

async function pollConnection(svc: Svc, ec: EmailConnRow): Promise<{ suggested: number; queued: number; skipped: number }> {
  // 1. Fresh Microsoft access token, via the rep's existing calendar OAuth grant.
  const { data: oc } = await svc
    .from("oauth_connections").select("id, status")
    .eq("provider", "microsoft").eq("user_id", ec.user_id).maybeSingle();
  if (!oc || oc.status !== "active") { await setHealth(svc, ec.id, "needs_reauth"); return { suggested: 0, queued: 0, skipped: 0 }; }

  const { data: bundleJson } = await svc.rpc("oauth_token_get", { p_connection_id: oc.id });
  if (!bundleJson) { await setHealth(svc, ec.id, "needs_reauth"); return { suggested: 0, queued: 0, skipped: 0 }; }

  const fresh = await microsoftProvider.refreshAccessToken(bundleJson as TokenBundle, {
    clientId: Deno.env.get(microsoftProvider.oauth.clientIdEnv) ?? "",
    clientSecret: Deno.env.get(microsoftProvider.oauth.clientSecretEnv) ?? "",
  });
  if (fresh.refreshed) {
    await svc.rpc("oauth_token_set", { p_connection_id: oc.id, p_token: fresh.bundle });
    await svc.from("oauth_connections").update({ last_refreshed_at: new Date().toISOString() }).eq("id", oc.id);
  }

  // 2. Context for the matcher: internal domain (rep's own), the rep's deals.
  const { data: prof } = await svc.from("profiles").select("email").eq("id", ec.user_id).maybeSingle();
  const senderEmail = (prof?.email as string | undefined) ?? "";
  const internalDomains = senderEmail.includes("@") ? [senderEmail.split("@")[1].toLowerCase()] : [];

  const { data: dealsRaw } = await svc.from("deals").select("id, contact_email").eq("owner_id", ec.user_id).eq("org_id", ec.org_id);
  const deals: EmailMatchDeal[] = (dealsRaw ?? []).map((d) => ({ id: d.id as string, contactEmail: (d.contact_email as string | null) ?? null }));

  // 3. Delta-query Sent Items (metadata only).
  const { messages, deltaLink } = await collectSentDelta(fresh.accessToken, buildSentDeltaUrl(ec.delta_token ?? null), fetch);

  // 4. Threads already captured (dedup) among this batch.
  const threadIds = [...new Set(messages.map((m) => m.conversationId).filter((t): t is string => Boolean(t)))];
  let capturedThreadIds = new Set<string>();
  if (threadIds.length) {
    const { data: existing } = await svc.from("email_activity").select("thread_id").eq("org_id", ec.org_id).in("thread_id", threadIds);
    capturedThreadIds = new Set((existing ?? []).map((r) => r.thread_id as string).filter(Boolean));
  }

  // 5. Route + write. Idempotent on (provider, provider_message_id).
  const out = processSentMessages({
    messages, orgId: ec.org_id, senderUserId: ec.user_id, provider: "outlook",
    deals, internalDomains, personalDomains: PERSONAL_DOMAINS, capturedThreadIds,
  });
  if (out.suggestions.length) {
    await svc.from("email_activity").upsert(out.suggestions, { onConflict: "provider,provider_message_id", ignoreDuplicates: true });
  }
  if (out.queued.length) {
    await svc.from("email_unmatched_queue").upsert(out.queued, { onConflict: "provider,provider_message_id", ignoreDuplicates: true });
  }

  // 6. Advance the cursor + mark healthy.
  await svc.from("email_connection")
    .update({ last_poll_at: new Date().toISOString(), delta_token: deltaLink ?? ec.delta_token, health: "ok", last_error: null })
    .eq("id", ec.id);

  return { suggested: out.suggestions.length, queued: out.queued.length, skipped: out.skipped.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const denied = requireCronCaller(req, CRON_SECRET);
  if (denied) return denied;
  if (!EMAIL_CAPTURE_ENABLED) return json({ skipped: "disabled" });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: conns, error } = await svc
    .from("email_connection").select("id, user_id, org_id, delta_token").eq("provider", "outlook");
  if (error) return json({ error: error.message }, 500);

  const totals = { connections: 0, suggested: 0, queued: 0, skipped: 0 };
  for (const ec of (conns ?? []) as EmailConnRow[]) {
    try {
      const r = await pollConnection(svc, ec);
      totals.connections++; totals.suggested += r.suggested; totals.queued += r.queued; totals.skipped += r.skipped;
    } catch (e) {
      await setHealth(svc, ec.id, "error", String(e instanceof Error ? e.message : e));
    }
  }
  return json(totals);
});
