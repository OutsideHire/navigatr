/**
 * Parse a Supabase auth-redirect error from the /auth/callback URL.
 *
 * When an email link (magic-link, invite, or password reset) is expired or
 * invalid, Supabase redirects here with the reason in the URL HASH fragment
 * (e.g. `#error=access_denied&error_code=otp_expired&error_description=...`).
 * That is the hash, NOT the query string, so `useSearchParams` never sees it.
 * Returns a friendly, actionable message when such an error is present, or null
 * for a normal token-bearing callback.
 */
export function parseAuthCallbackError(hash: string, query: URLSearchParams): string | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, ""));
  const code = fromHash.get("error_code") ?? query.get("error_code");
  const err = fromHash.get("error") ?? query.get("error");
  const description = fromHash.get("error_description") ?? query.get("error_description");

  if (!code && !err) return null;

  // Key the "request a new one" copy on an actual expiry: the otp_expired code,
  // or "expired" in the description (Supabase's email-link message is "Email
  // link is invalid or has expired"). A bare "invalid" (e.g. OAuth
  // invalid_grant) falls through to the generic branch, since "request a new
  // one" is the wrong remedy there.
  const looksExpired = code === "otp_expired" || /\bexpired\b/i.test(description ?? "");
  if (looksExpired) {
    return "This link has expired or is no longer valid. Request a new one and try again.";
  }
  return description
    ? `We could not sign you in: ${description}`
    : "This sign-in link is no longer valid. Request a new one and try again.";
}
