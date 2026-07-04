// Google OAuth token helpers. Pure functions (isExpired, mapTokenResponse) are
// vitest-unit-tested from the app; getFreshAccessToken keeps its fetch + env
// injectable so it too can be exercised without touching the network. Deno-free
// so the app can import it the same way it imports calendarQualify.ts.

/** The token bundle persisted in Vault (see oauth_token_set migration). */
export interface TokenBundle {
  access_token: string;
  refresh_token: string;
  expiry: string; // ISO 8601
}

/** Google's refresh/exchange response subset we consume. */
export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number; // seconds
  refresh_token?: string;
}

/**
 * True when `expiryIso` is at or before `nowMs + skewMs`. The skew treats
 * tokens that are about to expire as already expired, so an in-flight request
 * doesn't race the boundary. Unparseable/empty expiry counts as expired.
 */
export function isExpired(expiryIso: string, nowMs: number, skewMs = 60_000): boolean {
  const expiryMs = Date.parse(expiryIso);
  if (Number.isNaN(expiryMs)) return true;
  return expiryMs <= nowMs + skewMs;
}

/**
 * Map Google's token response to a bundle patch: the new access_token and the
 * absolute ISO expiry (now + expires_in). Does not carry refresh_token — Google
 * omits it on refresh grants, so callers keep the existing one.
 */
export function mapTokenResponse(
  json: GoogleTokenResponse,
  nowMs: number,
): { access_token: string; expiry: string } {
  return {
    access_token: json.access_token,
    expiry: new Date(nowMs + json.expires_in * 1000).toISOString(),
  };
}

export interface FreshTokenDeps {
  clientId: string;
  clientSecret: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
  tokenUrl?: string;
}

export interface FreshTokenResult {
  accessToken: string;
  /** The (possibly unchanged) bundle to persist back. */
  bundle: TokenBundle;
  /** True when a refresh happened and the bundle should be re-saved. */
  refreshed: boolean;
}

/**
 * Return a currently-valid access token for `bundle`. If the token is still
 * fresh, returns it unchanged (refreshed=false). Otherwise POSTs the
 * refresh_token grant to Google, folds the result into the bundle (keeping the
 * existing refresh_token) and returns it with refreshed=true so the caller can
 * persist the new access_token/expiry.
 */
export async function getFreshAccessToken(
  bundle: TokenBundle,
  deps: FreshTokenDeps,
): Promise<FreshTokenResult> {
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const tokenUrl = deps.tokenUrl ?? "https://oauth2.googleapis.com/token";
  const nowMs = now();

  if (!isExpired(bundle.expiry, nowMs)) {
    return { accessToken: bundle.access_token, bundle, refreshed: false };
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: bundle.refresh_token,
    client_id: deps.clientId,
    client_secret: deps.clientSecret,
  });
  const res = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    throw new Error(`token refresh failed: http ${res.status}`);
  }
  const jsonRes = (await res.json()) as GoogleTokenResponse;
  const patch = mapTokenResponse(jsonRes, nowMs);
  const nextBundle: TokenBundle = {
    access_token: patch.access_token,
    // Google returns a refresh_token only on the initial consent; keep ours.
    refresh_token: jsonRes.refresh_token ?? bundle.refresh_token,
    expiry: patch.expiry,
  };
  return { accessToken: nextBundle.access_token, bundle: nextBundle, refreshed: true };
}
