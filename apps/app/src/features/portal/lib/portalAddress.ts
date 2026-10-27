/**
 * The ONE place portal links are built (custom-domain readiness). Every in-app
 * link and shareable address goes through here, so serving the portal from a
 * custom web address later is a change to portalOrigin/portalPath, not a hunt.
 */

/** The origin portal addresses are served from. Today: the app's own origin. */
export function portalOrigin(): string {
  return window.location.origin;
}

/** The in-app (relative) portal path: /p/<slug><sub>. The slug is used as given. */
export function portalPath(slug: string, sub = ""): string {
  return `/p/${slug}${sub}`;
}

/** The partner-facing portal address for a tenant (spec 5.3, FR-PORT-23). */
export function portalAddress(slug: string, origin: string = portalOrigin()): string {
  return `${origin.replace(/\/+$/, "")}${portalPath(encodeURIComponent(slug))}`;
}

/** A public referral form address (Phase 2B-1, FR-PORT-24): <origin>/p/<slug>/refer/<token>. */
export function referralFormAddress(slug: string, token: string, origin: string = portalOrigin()): string {
  return `${portalAddress(slug, origin)}/refer/${encodeURIComponent(token)}`;
}
