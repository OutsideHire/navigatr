// Supabase Edge Function: sends invite emails via Resend.
//
// Body: { invite_ids: string[] }
// Auth: must be called with an authenticated user JWT (Supabase injects it
//       as the Authorization header). RLS on org_invites ensures the caller
//       can only see their own org's invites; we re-query through the
//       user's JWT, not the service role, so PII can't leak across orgs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";
import { renderEmail } from "../_shared/emailTemplate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "invites@navigatr.app";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://navigatr.app";

// Browser callers (supabase-js functions.invoke) trigger a CORS preflight;
// without these headers + an OPTIONS handler the browser blocks the call
// before the function runs. Mirrors the geocode function's CORS handling.
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

const resend = new Resend(RESEND_API_KEY);

interface Invite {
  id: string;
  email: string;
  token: string;
  full_name: string | null;
  org_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  console.log("send_invite_email config:", {
    from: FROM_ADDRESS,
    appBase: APP_BASE_URL,
    hasKey: RESEND_API_KEY ? "yes" : "no",
  });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "missing_authorization" }, 401);
  }
  const body = await req.json().catch(() => null) as { invite_ids?: string[] } | null;
  if (!body?.invite_ids || !Array.isArray(body.invite_ids)) {
    return json({ error: "invalid_body" }, 400);
  }

  // Query using the user's JWT so RLS applies.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: invites, error: iErr } = await userClient
    .from("org_invites")
    .select("id, email, token, full_name, org_id")
    .in("id", body.invite_ids)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (iErr) {
    console.error("invite lookup error:", iErr.message);
    return json({ error: iErr.message }, 400);
  }
  console.log("invites found:", invites?.length ?? 0);

  // Org name for personalization. RLS gives the caller their own org only.
  const { data: orgs } = await userClient
    .from("organizations")
    .select("id, name")
    .limit(1);
  const orgName = (orgs?.[0] as { name?: string } | undefined)?.name ?? "your workspace";

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const inv of (invites ?? []) as Invite[]) {
    const link = `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inv.token)}`;
    const { html, text } = renderEmail({
      preheader: `You're invited to ${orgName} on navigatr`,
      heading: `You're invited to ${orgName}`,
      bodyLines: [`${inv.full_name ? inv.full_name + ", your" : "Your"} navigatr account at ${orgName} is ready.`],
      ctaLabel: "Accept invite",
      ctaUrl: link,
      footnote: "This invite expires in 14 days. If you weren't expecting it, you can ignore this email.",
    });
    try {
      const send = await resend.emails.send({ from: FROM_ADDRESS, to: inv.email, subject: `You're invited to ${orgName} on navigatr`, html, text });
      if ((send as { error?: unknown }).error) {
        console.error("RESEND REJECTED for", inv.email, ":", JSON.stringify((send as { error: unknown }).error));
        results.push({ id: inv.id, ok: false, error: String((send as { error: unknown }).error) });
      } else {
        console.log("RESEND OK for", inv.email);
        results.push({ id: inv.id, ok: true });
      }
    } catch (e) {
      console.error("RESEND THREW for", inv.email, ":", e instanceof Error ? e.message : String(e));
      results.push({ id: inv.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({ results });
});
