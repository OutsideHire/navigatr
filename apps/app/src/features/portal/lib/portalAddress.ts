/** The partner-facing portal address for a tenant (spec 5.3, FR-PORT-23). */
export function portalAddress(slug: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}`;
}

/** A public referral form address (Phase 2B-1, FR-PORT-24): <origin>/p/<slug>/refer/<token>. */
export function referralFormAddress(slug: string, token: string, origin: string = window.location.origin): string {
  return `${portalAddress(slug, origin)}/refer/${encodeURIComponent(token)}`;
}
