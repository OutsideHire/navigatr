/**
 * Partner portal session storage (spec 5.3). One token per tenant slug, under a
 * portal-only key, never shared with the app's Supabase session. Every storage
 * access is wrapped: private browsing or blocked site data must not break
 * sign-in, so a write that storage refuses is kept in memory for this page view.
 */
const memory = new Map<string, string>();

export function portalSessionKey(slug: string): string {
  return `navigatr-portal-session:${slug}`;
}

export function readPortalSession(slug: string): string | null {
  const key = portalSessionKey(slug);
  try {
    return window.localStorage.getItem(key) || null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writePortalSession(slug: string, token: string): void {
  const key = portalSessionKey(slug);
  memory.set(key, token);
  try {
    window.localStorage.setItem(key, token);
  } catch {
    // Storage refused (private mode); the in-memory copy covers this page view.
  }
}

export function clearPortalSession(slug: string): void {
  const key = portalSessionKey(slug);
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored that we can reach; the in-memory copy is already gone.
  }
}
