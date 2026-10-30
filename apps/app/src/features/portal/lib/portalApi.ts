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
  PortalExport,
  PortalExportRow,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
  PortalReferralUpdate,
} from "../../../../../../supabase/functions/_shared/portalReferralApi";
import type {
  PortalPartnerNote,
  PortalSentReferralDetail,
  PortalSentReferralSummary,
} from "../../../../../../supabase/functions/_shared/portalSentApi";
import type { PortalWindow } from "../../../../../../supabase/functions/_shared/portalSubmission";
import type { PortalProfile, PortalProfileInput } from "../../../../../../supabase/functions/_shared/portalProfile";
import type {
  PortalPublicForm,
  PortalPublicSubmitInput,
  PortalPublicSubmitted,
} from "../../../../../../supabase/functions/_shared/portalPublicForm";

export type {
  PortalDashboard,
  PortalExport,
  PortalExportRow,
  PortalForm,
  PortalReferralDetail,
  PortalReferralSummary,
  PortalReferralUpdate,
  PortalWindow,
  PortalProfile,
  PortalProfileInput,
  PortalPublicForm,
  PortalPublicSubmitInput,
  PortalPublicSubmitted,
  PortalPartnerNote,
  PortalSentReferralDetail,
  PortalSentReferralSummary,
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
  /** navigatr's own Referral Portal Terms, accepted with the ISO's by the same checkbox. */
  navigatrTermsText: string;
  navigatrTermsVersion: string;
}

export interface PortalSession {
  sessionToken: string;
  expiresAt: string;
}

export interface PortalMe {
  partnerName: string;
  email: string;
  orgName: string;
  /** FR-PORT-18: false once the ISO changed its terms, until the partner accepts them. */
  termsCurrent: boolean;
}

/** The terms a signed-in partner is asked to accept (FR-PORT-18): the ISO's and navigatr's. */
export interface PortalTerms {
  termsText: string;
  termsVersion: number;
  /** True only when both the ISO's and navigatr's current terms are accepted. */
  termsCurrent: boolean;
  navigatrTermsText: string;
  navigatrTermsVersion: string;
}

export type PortalSubmitInput = {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  industry: string;
  urgency: string;
  employeeCount: string;
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
  | "get_terms"
  | "accept_terms"
  | "sign_out"
  | "form"
  | "dup_check"
  | "submit_referral"
  | "list_referrals"
  | "dashboard"
  | "get_referral"
  | "withdraw_referral"
  | "transcribe"
  | "export_referrals"
  | "get_profile"
  | "update_profile"
  | "public_form"
  | "public_submit"
  | "list_sent_referrals"
  | "get_sent_referral"
  | "post_note"
  | "unsubscribe_digest";

/**
 * FR-PORT-18: every signed-in data action answers 403 terms_required while the
 * partner has not accepted the ISO's current terms. The signed-in layout listens
 * here so whichever request hits it first (a poll, a submit) brings up the terms
 * page, without every page handling the case itself.
 */
const termsRequiredListeners = new Set<() => void>();

export function onPortalTermsRequired(listener: () => void): () => void {
  termsRequiredListeners.add(listener);
  return () => {
    termsRequiredListeners.delete(listener);
  };
}

export function notifyPortalTermsRequired(): void {
  termsRequiredListeners.forEach((listener) => listener());
}

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
    if (res.status === 403 && code === "terms_required") notifyPortalTermsRequired();
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

  acceptInvite(slug: string, token: string, termsVersion: number, navigatrTermsVersion: string): Promise<PortalSession> {
    return portalRequest<PortalSession>("accept_invite", { slug, token, termsVersion, navigatrTermsVersion });
  },

  me(slug: string, sessionToken: string): Promise<PortalMe | null> {
    return portalRequest<{ me: PortalMe }>("me", { slug }, sessionToken).then((r) => r.me, nullOn(401));
  },

  /** FR-PORT-18. Null when the session is gone (401). */
  getTerms(slug: string, sessionToken: string): Promise<PortalTerms | null> {
    return portalRequest<{ terms: PortalTerms }>("get_terms", { slug }, sessionToken).then((r) => r.terms, nullOn(401));
  },

  /** Throws PortalApiError: 409 terms_changed (read them again), 401 unauthorized. */
  async acceptTerms(slug: string, sessionToken: string, termsVersion: number, navigatrTermsVersion: string): Promise<void> {
    await portalRequest<{ ok: boolean }>("accept_terms", { slug, termsVersion, navigatrTermsVersion }, sessionToken);
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
  exportReferrals(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalExport> {
    return portalRequest<{ export: PortalExport }>("export_referrals", { slug, window: period }, sessionToken).then(
      (r) => r.export,
    );
  },

  getProfile(slug: string, sessionToken: string): Promise<PortalProfile> {
    return portalRequest<{ profile: PortalProfile }>("get_profile", { slug }, sessionToken).then((r) => r.profile);
  },

  updateProfile(slug: string, sessionToken: string, input: PortalProfileInput): Promise<PortalProfile> {
    return portalRequest<{ profile: PortalProfile }>("update_profile", { slug, ...input }, sessionToken).then(
      (r) => r.profile,
    );
  },

  /** Phase 2B-1 public referral form: no session. Null when the link is not available (404). */
  publicForm(slug: string, token: string): Promise<PortalPublicForm | null> {
    return portalRequest<{ form: PortalPublicForm }>("public_form", { slug, token }).then((r) => r.form, nullOn(404));
  },

  /** Throws PortalApiError: 429 captcha_required or rate_limited, 409 form_expired or consent_changed, 400 invalid_body (field), 404 or 503 not_available. */
  publicSubmit(slug: string, token: string, input: PortalPublicSubmitInput): Promise<PortalPublicSubmitted> {
    return portalRequest<{ submission: PortalPublicSubmitted }>("public_submit", { slug, token, ...input }).then(
      (r) => r.submission,
    );
  },

  /** Phase 2B-3: referrals the ISO sent to this partner. */
  listSentReferrals(slug: string, sessionToken: string, period: PortalWindow): Promise<PortalSentReferralSummary[]> {
    return portalRequest<{ referrals: PortalSentReferralSummary[] }>(
      "list_sent_referrals",
      { slug, window: period },
      sessionToken,
    ).then((r) => r.referrals);
  },

  getSentReferral(slug: string, sessionToken: string, referralId: string): Promise<PortalSentReferralDetail | null> {
    return portalRequest<{ referral: PortalSentReferralDetail }>("get_sent_referral", { slug, referralId }, sessionToken).then(
      (r) => r.referral,
      nullOn(404),
    );
  },

  /** Throws PortalApiError: 404 not_found, 400 invalid_body (field body), 429 rate_limited. */
  postNote(slug: string, sessionToken: string, referralId: string, body: string): Promise<PortalPartnerNote> {
    return portalRequest<{ note: PortalPartnerNote }>("post_note", { slug, referralId, body }, sessionToken).then(
      (r) => r.note,
    );
  },

  /** The weekly summary opt-out (no session). Resolves the same whatever the token. */
  async unsubscribeDigest(slug: string, token: string): Promise<void> {
    await portalRequest<{ ok: boolean }>("unsubscribe_digest", { slug, token });
  },
};
