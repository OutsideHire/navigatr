// Supabase Send-Email auth hook target. Supabase POSTs each auth email
// (signup / recovery / magiclink) here; we verify the hook signature, render
// the shared branded template, and send via Resend. Server-to-server webhook
// (no browser), so no CORS needed. Deployed via the Supabase dashboard.
import { Resend } from "resend";
import { Webhook } from "standardwebhooks";
import { renderEmail } from "../_shared/emailTemplate.ts";
import { authEmailContent, buildVerifyUrl } from "../_shared/authEmail.ts";
import { shouldSend } from "../_shared/emailGuard.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
// Outside production only allowlisted recipients are deliverable. Unset APP_ENV
// fails closed. See _shared/emailGuard.ts.
const APP_ENV = Deno.env.get("APP_ENV");
const EMAIL_ALLOWLIST = Deno.env.get("EMAIL_ALLOWLIST") ?? "";
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS") ?? "navigatr <invites@send.getnavigatr.io>";
// Supabase provides the hook secret as "v1,whsec_<base64>"; standardwebhooks
// wants the base64 portion.
const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace("v1,whsec_", "");

const resend = new Resend(RESEND_API_KEY);

// Supabase's Send-Email hook parses the response as JSON; without an explicit
// application/json content-type it treats a successful send as a malformed
// response ("Invalid JSON response ... text/plain") even though the email went.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  // Verify the request really came from Supabase.
  try {
    new Webhook(HOOK_SECRET).verify(payload, headers);
  } catch (e) {
    console.error("hook signature verify failed:", e instanceof Error ? e.message : String(e));
    return json({ error: "invalid_signature" }, 401);
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

  // Outside production, drop non-allowlisted recipients. Returns 200 like every
  // other path here: Supabase's Send-Email hook treats a non-200 as "you
  // failed, I will send my own version instead", which on staging would defeat
  // the whole point by delivering an unbranded email to the same person.
  if (!shouldSend(APP_ENV, EMAIL_ALLOWLIST, body.user.email)) {
    console.log(
      `[emailGuard] dropped ${d.email_action_type} to ${body.user.email} in APP_ENV=${APP_ENV ?? "(unset)"}`,
    );
    return json({}, 200);
  }

  try {
    const r = await resend.emails.send({
      from: FROM_ADDRESS, to: body.user.email, subject: content.subject, html, text,
    });
    if ((r as { error?: unknown }).error) {
      console.error("RESEND REJECTED:", JSON.stringify((r as { error: unknown }).error));
      // Return 200 so Supabase does not also fall back to its own email; the
      // error is logged for us. (To prefer Supabase's fallback on failure,
      // return a non-200 here instead.)
      return json({}, 200);
    }
  } catch (e) {
    console.error("RESEND THREW:", e instanceof Error ? e.message : String(e));
    return json({}, 200);
  }

  return json({}, 200);
});
