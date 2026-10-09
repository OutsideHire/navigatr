/**
 * Partner portal API client (spec 5.11).
 *
 * Talks to the portal_api edge function with plain fetch, deliberately NOT
 * supabase.functions.invoke: the app's session guard (lib/sessionGuard.ts)
 * rewrites an anon bearer into an internal user's JWT, and a partner request
 * must never carry one. The partner's own session travels in x-portal-session.
 *
 * Expected outcomes come back as values, not errors (an unavailable portal or a
 * dead invite is null, a dead session from me() is null), so React Query does
 * not report them to Sentry as failures.
 */
const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || "http://localhost:54321";
const ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || "test-anon-key-placeholder";

export const PORTAL_API_URL = `${SUPABASE_URL}/functions/v1/portal_api`;

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

export class PortalApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "PortalApiError";
    this.status = status;
    this.code = code;
  }
}

type PortalAction = "brand" | "request_code" | "verify_code" | "peek_invite" | "accept_invite" | "me" | "sign_out";

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
    const code =
      payload !== null && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "request_failed";
    throw new PortalApiError(res.status, code);
  }
  return payload as T;
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
};
