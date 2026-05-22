// Supabase Edge Function: sends invite emails via Resend.
//
// Body: { invite_ids: string[] }
// Auth: must be called with an authenticated user JWT (Supabase injects it
//       as the Authorization header). RLS on org_invites ensures the caller
//       can only see their own org's invites; we re-query through the
//       user's JWT, not the service role, so PII can't leak across orgs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "resend";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "invites@navigatr.app";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://navigatr.app";

const resend = new Resend(RESEND_API_KEY);

interface Invite {
  id: string;
  email: string;
  token: string;
  full_name: string | null;
  org_id: string;
}

interface OrgRow { name: string }

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "missing_authorization" }), { status: 401 });
  }
  const body = await req.json().catch(() => null) as { invite_ids?: string[] } | null;
  if (!body?.invite_ids || !Array.isArray(body.invite_ids)) {
    return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 });
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
    return new Response(JSON.stringify({ error: iErr.message }), { status: 400 });
  }

  // Org names for personalization. RLS gives the caller their own org only,
  // so this returns 0 or 1 row.
  const { data: orgs } = await userClient
    .from("organizations")
    .select("id, name")
    .limit(1);
  const orgName = (orgs?.[0] as { name?: string } | undefined)?.name ?? "your workspace";

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const inv of (invites ?? []) as Invite[]) {
    const link = `${APP_BASE_URL}/accept-invite?token=${encodeURIComponent(inv.token)}`;
    const subject = `You're invited to ${orgName} on navigatr`;
    const html = `
      <p>Hi${inv.full_name ? " " + inv.full_name : ""},</p>
      <p>Your account at <strong>${orgName}</strong> on navigatr is ready.</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2456E6;color:#fff;border-radius:6px;text-decoration:none">Sign in now</a></p>
      <p>Or paste this link: ${link}</p>
      <p style="color:#888;font-size:12px">This invite expires in 14 days. Reply if anything looks wrong.</p>
    `;
    try {
      const send = await resend.emails.send({
        from: FROM_ADDRESS, to: inv.email, subject, html,
      });
      if ((send as { error?: unknown }).error) {
        results.push({ id: inv.id, ok: false, error: String((send as { error: unknown }).error) });
      } else {
        results.push({ id: inv.id, ok: true });
      }
    } catch (e) {
      results.push({ id: inv.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return new Response(JSON.stringify({ results }), { status: 200, headers: { "Content-Type": "application/json" } });
});
