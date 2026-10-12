/**
 * Partner portal API client (spec 5.11).
 *
 * Talks to the portal_api edge function with plain fetch, deliberately NOT
 * supabase.functions.invoke: the app's session guard (lib/sessionGuard.ts)
 * rewrites an anon bearer into an internal user's JWT, and a partner request
 * must never carry one. The partner's own session travels in x-portal-session.
 *
 * Expected outcomes come back as values, not errors (an unavailable portal or a
 * dead invite is null, a dead session from me() is null, a referral that is not
 * the partner's is null), so React Query does not report them to Sentry as
 * failures.
 *
 * Phase 1B response types are imported from the edge module that builds them,
 * so the two sides cannot drift.
 */
import type {
  PortalDashboard,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
  PortalReferralUpdate,
} from "../../../../../../supabase/functions/_shared/portalReferralApi";
import type { PortalWindow } from "../../../../../../supabase/functions/_shared/portalSubmission";

export type {
  PortalDashboard,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
  PortalReferralUpdate,
  PortalWindow,
};

const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || "http://localhost:54321";
const ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || "test-anon-key-placeholder";

export const PORTAL_API_URL = `${SUPABASE_URL}/functions/v1/portal_api`;

/** Dashboard, list and detail refresh every 30 seconds (spec R10: the 60 second bar). */
export const PORTAL_POLL_MS = 30_000;

/** Query keys for partner data; sign-out drops everything under ["portal", "data", slug]. */
export function portalDataKey(
  slug: string,
  token: string,
  ...rest: Array<string | number | boolean | null>
): readonly unknown[] {
  return ["portal", "data", slug, token, ...rest];
}

export interface PortalBrand {
  orgName: string;
  productName: string;
  primaryColor: string | null;
  logoUrl: string | null;
  darkLogoUrl: string | null;
}

export interface PortalInvite {
  partnerName: string;
  orgName: string;
  termsText: string;
  termsVersion: number;
}

export interface PortalSession {
  sessionToken: string;
  expiresAt: string;
}

export interface PortalMe {
  partnerName: string;
  email: string;
  orgName: string;
}

export type PortalSubmitInput = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  industry: string;
  urgency: string;
  notes: string;
  consent: boolean;
  consentVersion: number;
};

export interface PortalSubmitted {
  id: string;
  ref: string;
}

export class PortalApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** For a 400 on submit_referral: which form field to point at. */
  readonly field: string | null;

  constructor(status: number, code: string, field: string | null = null) {
    super(code);
    this.name = "PortalApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

type PortalAction =
  | "brand"
  | "request_code"
  | "verify_code"
  | "peek_invite"
  | "accept_invite"
  | "me"
  | "sign_out"
  | "form"
  | "dup_check"
  | "submit_referral"
  | "list_referrals"
  | "dashboard"
  | "get_referral"
  | "withdraw_referral"
  | "transcribe";

async function portalRequest<T>(
  action: PortalAction,
  body: Record<string, unknown>,
  sessionToken?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  };
  if (sessionToken) headers["x-portal-session"] = sessionToken;

  let res: Response;
  try {
    res = await fetch(`${PORTAL_API_URL}/${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new PortalApiError(0, "network_error");
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const obj = payload !== null && typeof payload === "object" ? (payload as { error?: unknown; field?: unknown }) : {};
    const code = typeof obj.error === "string" ? obj.error : "request_failed";
    const field = typeof obj.field === "string" ? obj.field : null;
    throw new PortalApiError(res.status, code, field);
  }
  return payload as T;
}

/**
 * True when the portal could not be reached or failed on its side (network,
 * 5xx, or anything that is not a PortalApiError). Such failures get a retry,
 * never a "this link is dead" or "wrong code" answer.
 */
export function isPortalTransientError(err: unknown): boolean {
  if (!(err instanceof PortalApiError)) return true;
  return err.status === 0 || err.status >= 500;
}

/** The session is gone (expired, signed out elsewhere, suspended, revoked). */
export function isPortalUnauthorized(err: unknown): boolean {
  return err instanceof PortalApiError && err.status === 401;
}

function nullOn(status: number) {
  return (err: unknown): null => {
    if (err instanceof PortalApiError && err.status === status) return null;
    throw err;
  };
}

export const portalApi = {
  brand(slug: string): Promise<PortalBrand | null> {
    return portalRequest<{ brand: PortalBrand }>("brand", { slug }).then((r) => r.brand, nullOn(404));
  },

  async requestCode(slug: string, email: string): Promise<void> {
    await portalRequest<{ ok: boolean }>("request_code", { slug, email });
  },

  verifyCode(slug: string, email: string, code: string): Promise<PortalSession> {
    return portalRequest<PortalSession>("verify_code", { slug, email, code });
  },

  peekInvite(slug: string, token: string): Promise<PortalInvite | null> {
    return portalRequest<{ invite: PortalInvite }>("peek_invite", { slug, token }).then((r) => r.invite, nullOn(404));
  },

  acceptInvite(slug: string, token: string, termsVersion: number): Promise<PortalSession> {
    return portalRequest<PortalSession>("accept_invite", { slug, token, termsVersion });
  },

  me(slug: string, sessionToken: string): Promise<PortalMe | null> {
    return portalRequest<{ me: PortalMe }>("me", { slug }, sessionToken).then((r) => r.me, nullOn(401));
  },

  async signOut(sessionToken: string): Promise<void> {
    await portalRequest<{ ok: boolean }>("sign_out", {}, sessionToken);
  },

  form(slug: string, sessionToken: string): Promise<PortalForm> {
    return portalRequest<{ form: PortalForm }>("form", { slug }, sessionToken).then((r) => r.form);
  },

  dupCheck(
    slug: string,
    sessionToken: string,
    input: { companyName: string; phone: string; address: string },
  ): Promise<boolean> {
    return portalRequest<{ probableDuplicate: boolean }>("dup_check", { slug, ...input }, sessionToken).then(
      (r) => r.probableDuplicate === true,
    );
  },

  submitReferral(slug: string, sessionToken: string, input: PortalSubmitInput): Promise<PortalSubmitted> {
    return portalRequest<{ referral: PortalSubmitted }>("submit_referral", { slug, ...input }, sessionToken).then(
      (r) => r.referral,
    );
  },

  listReferrals(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalReferralSummary[]> {
    return portalRequest<{ referrals: PortalReferralSummary[] }>("list_referrals", { slug, window: period }, sessionToken).then(
      (r) => r.referrals,
    );
  },

  dashboard(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalDashboard> {
    return portalRequest<{ dashboard: PortalDashboard }>("dashboard", { slug, window: period }, sessionToken).then(
      (r) => r.dashboard,
    );
  },

  getReferral(slug: string, sessionToken: string, referralId: string): Promise<PortalReferralDetail | null> {
    return portalRequest<{ referral: PortalReferralDetail }>("get_referral", { slug, referralId }, sessionToken).then(
      (r) => r.referral,
      nullOn(404),
    );
  },

  async withdrawReferral(slug: string, sessionToken: string, referralId: string): Promise<void> {
    await portalRequest<{ ok: boolean }>("withdraw_referral", { slug, referralId }, sessionToken);
  },

  transcribe(slug: string, sessionToken: string, audio: string, mime: string): Promise<string> {
    return portalRequest<{ text: string }>("transcribe", { slug, audio, mime }, sessionToken).then((r) => r.text);
  },
};
