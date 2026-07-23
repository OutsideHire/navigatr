// Supabase Send-Email auth hook target. Supabase POSTs each auth email
// (signup / recovery / magiclink) here; we verify the hook signature, render
// the shared branded template, and send via Resend. Server-to-server webhook
// (no browser), so no CORS needed. Deployed via the Supabase dashboard.
import { Resend } from "resend";
import { Webhook } from "standardwebhooks";
import { renderEmail } from "../_shared/emailTemplate.ts";
import { authEmailContent, buildVerifyUrl } from "../_shared/authEmail.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "navigatr <invites@send.getnavigatr.io>";
// Supabase provides the hook secret as "v1,whsec_<base64>"; standardwebhooks
// wants the base64 portion.
const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace("v1,whsec_", "");

const resend = new Resend(RESEND_API_KEY);

Deno.serve(async (req) => {
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  // Verify the request really came from Supabase.
  try {
    new Webhook(HOOK_SECRET).verify(payload, headers);
  } catch (e) {
    console.error("hook signature verify failed:", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: "invalid_signature" }), { status: 401 });
  }

  const body = JSON.parse(payload) as {
    user: { email: string };
    email_data: {
      token: string;
      token_hash: string;
      redirect_to: string;
      email_action_type: string;
      site_url: string;
    };
  };
  const d = body.email_data;
  console.log("send_auth_email:", d.email_action_type, "->", body.user.email);

  const content = authEmailContent(d.email_action_type);
  const ctaUrl = buildVerifyUrl({
    siteUrl: d.site_url,
    tokenHash: d.token_hash,
    type: d.email_action_type,
    redirectTo: d.redirect_to,
  });
  const { html, text } = renderEmail({
    preheader: content.heading,
    heading: content.heading,
    bodyLines: content.bodyLines,
    ctaLabel: content.ctaLabel,
    ctaUrl,
    footnote: content.footnote,
    code: d.email_action_type === "magiclink" ? d.token : undefined,
  });

  try {
    const r = await resend.emails.send({
      from: FROM_ADDRESS, to: body.user.email, subject: content.subject, html, text,
    });
    if ((r as { error?: unknown }).error) {
      console.error("RESEND REJECTED:", JSON.stringify((r as { error: unknown }).error));
      // Return 200 so Supabase does not also fall back to its own email; the
      // error is logged for us. (To prefer Supabase's fallback on failure,
      // return a non-200 here instead.)
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }
  } catch (e) {
    console.error("RESEND THREW:", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
