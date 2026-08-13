/**
 * Stops non-production environments emailing real people.
 *
 * Staging and demo run the same code as production against the same schema, so
 * they can hold realistic-looking contact rows and they have working Resend
 * credentials. Without this, one run of the CSV invite wizard on staging emails
 * whoever is in that database, from a half-finished build, and the recipient has
 * no way to know it was not real.
 *
 * FAILS CLOSED, deliberately. If APP_ENV is unset the answer is "do not send",
 * not "assume production". A new environment nobody remembered to configure is
 * exactly the one that should not be able to mail customers. The cost of that
 * choice is the opposite failure: deploying this to production BEFORE
 * APP_ENV=production exists there would silently drop every invite and every
 * password reset. That ordering is called out in the plan and APP_ENV was set on
 * production on 2026-08-13, ahead of this code, so the hazard cannot fire.
 *
 * Plain dependency-free TS with no Deno globals at module scope, so the app's
 * vitest run unit-tests it, matching the other _shared modules.
 */

/**
 * Should this recipient actually be emailed?
 *
 * @param appEnv     the APP_ENV secret. Only the exact string "production"
 *                   disables the allowlist; "Production", "prod" and a trailing
 *                   space all count as non-production, because a near-miss value
 *                   silently behaving as production is the failure this exists
 *                   to prevent.
 * @param allowlist  comma-separated addresses, from EMAIL_ALLOWLIST. Empty means
 *                   nothing is deliverable, which is how demo is configured.
 * @param recipient  the address the caller wants to send to.
 */
export function shouldSend(
  appEnv: string | null | undefined,
  allowlist: string | null | undefined,
  recipient: string,
): boolean {
  if (appEnv === "production") return true;

  const allowed = (allowlist ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  // Exact match on the whole address, never a substring: an allowlisted
  // "ceo@outsidehire.com" must not admit "evil-ceo@outsidehire.com.attacker.test".
  return allowed.includes(recipient.trim().toLowerCase());
}
