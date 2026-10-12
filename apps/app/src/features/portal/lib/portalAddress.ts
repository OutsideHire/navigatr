/** The partner-facing portal address for a tenant (spec 5.3, FR-PORT-23). */
export function portalAddress(slug: string, origin: string = window.location.origin): string {
  return `${origin.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}`;
}
