/**
 * Request handler for the portal_invite edge function (Partner Portal, spec 5.3).
 *
 * A signed-in rep (or anyone above them who can see the partner, or an admin)
 * invites a partner. The caller is verified with auth.getUser() in index.ts and
 * passed in as getUserId(); portal_create_invite re-checks that this user can see
 * the partner, that the portal is on, and that the partner has an email. The raw
 * invite token goes only into the email: reps never handle the link.
 *
 * Pure TS with injected dependencies (no Deno globals at module scope) so the
 * app's vitest run covers it.
 */
import { shouldSend } from "./emailGuard.ts";
import { renderEmail } from "./emailTemplate.ts";
import { portalFromAddress, portalInviteEmail, portalUrl } from "./portalEmail.ts";
import {
  firstRow,
  jsonResponse,
  type PortalEmailMessage,
  type PortalEnv,
  type PortalRpcResult,
} from "./portalApi.ts";

export const INVITE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const INVITE_ERROR_STATUS: Record<string, number> = {
  not_authorized: 403,
  partner_not_found: 404,
  portal_disabled: 409,
  partner_email_required: 422,
  portal_already_active: 409,
  portal_email_in_use: 409,
};

export interface PortalInviteDeps {
  getUserId(): Promise<string | null>;
  rpc(name: string, args: Record<string, unknown>): Promise<PortalRpcResult>;
  sendEmail(msg: PortalEmailMessage): Promise<void>;
  env: PortalEnv;
}

interface CreatedInviteRow {
  invite_token: string;
  invite_email: string;
  partner_name: string;
  org_name: string;
  org_slug: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_BODY_CHARS = 1024;

export async function handlePortalInvite(req: Request, deps: PortalInviteDeps): Promise<Response> {
  const json = (body: unknown, status = 200) => jsonResponse(body, status, INVITE_CORS_HEADERS);

  if (req.method === "OPTIONS") return new Response("ok", { headers: INVITE_CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // A throwing dependency must never leak detail: generic status, nothing logged
  // that could carry a token.
  let stage: "auth" | "create" | "send" = "auth";
  try {
    const userId = await deps.getUserId();
    if (!userId) return json({ error: "unauthorized" }, 401);

    let partnerId = "";
    try {
      const raw = await req.text();
      if (raw.length <= MAX_BODY_CHARS) {
        const parsed = JSON.parse(raw) as { partnerId?: unknown } | null;
        partnerId = typeof parsed?.partnerId === "string" ? parsed.partnerId : "";
      }
    } catch {
      partnerId = "";
    }
    if (!UUID_RE.test(partnerId)) return json({ error: "invalid_body" }, 400);

    stage = "create";
    const { data, error } = await deps.rpc("portal_create_invite", { p_partner_id: partnerId, p_actor: userId });
    if (error) {
      const message = error.message;
      const code = Object.keys(INVITE_ERROR_STATUS).find((token) => message.includes(token));
      if (!code) {
        console.error("[portal_invite] create failed:", message);
        return json({ error: "invite_failed" }, 500);
      }
      return json({ error: code }, INVITE_ERROR_STATUS[code]);
    }

    const row = firstRow<CreatedInviteRow>(data);
    if (!row?.invite_token) return json({ error: "invite_failed" }, 500);

    if (!shouldSend(deps.env.appEnv, deps.env.emailAllowlist, row.invite_email)) {
      console.log(`[portal_invite][emailGuard] dropped an invite in APP_ENV=${deps.env.appEnv ?? "(unset)"}`);
      return json({ ok: true, emailed: false });
    }

    const built = portalInviteEmail({
      orgName: row.org_name,
      partnerName: row.partner_name,
      inviteUrl: portalUrl(deps.env.appBaseUrl, row.org_slug, `/invite?token=${encodeURIComponent(row.invite_token)}`),
    });
    const { html, text } = renderEmail(built);
    stage = "send";
    try {
      await deps.sendEmail({
        from: portalFromAddress(deps.env.fromAddress, row.org_name),
        to: row.invite_email,
        subject: built.subject,
        html,
        text,
      });
    } catch (e) {
      console.error("[portal_invite] send failed:", e instanceof Error ? e.message : String(e));
      return json({ error: "email_failed" }, 502);
    }
    return json({ ok: true, emailed: true });
  } catch {
    if (stage === "auth") return json({ error: "unauthorized" }, 401);
    if (stage === "send") return json({ error: "email_failed" }, 502);
    return json({ error: "invite_failed" }, 500);
  }
}
