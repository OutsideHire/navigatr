/**
 * scrubUrl.ts: strip secrets from URLs before they leave the browser in
 * telemetry (Vercel Analytics page views, Sentry events and breadcrumbs).
 *
 * Invite links carry a single-use token in the query string
 * (/p/:slug/invite?token=..., /accept-invite?token=...), and Supabase auth
 * redirects can carry access_token in the fragment. None of that may reach a
 * third party.
 */

const NAMED_SECRETS: ReadonlySet<string> = new Set(["token", "code", "invite", "access_token", "refresh_token"]);
const SUFFIX_SECRET_RE = /(^|_)(token|key|code|secret)$/i;

export function isSensitiveUrlParam(key: string): boolean {
  return NAMED_SECRETS.has(key.toLowerCase()) || SUFFIX_SECRET_RE.test(key);
}

export type ScrubMode = "remove" | "redact";

const REDACTED = "[redacted]";

function scrubParams(params: URLSearchParams, mode: ScrubMode): boolean {
  const keys = Array.from(new Set(Array.from(params.keys()))).filter(isSensitiveUrlParam);
  for (const key of keys) {
    if (mode === "remove") params.delete(key);
    else params.set(key, REDACTED);
  }
  return keys.length > 0;
}

function scrubPart(part: string, mode: ScrubMode): string {
  // part is a query string or a fragment, without its leading ? or #.
  if (!part.includes("=")) return part;
  const params = new URLSearchParams(part);
  return scrubParams(params, mode) ? params.toString() : part;
}

/**
 * Removes (default) or masks every sensitive query or fragment param, keeping
 * the rest of the URL. Relative URLs stay relative. Never throws.
 */
export function scrubUrl(url: string, mode: ScrubMode = "remove"): string {
  if (typeof url !== "string" || (!url.includes("?") && !url.includes("#"))) return url;
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? null : url.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? null : beforeHash.slice(queryAt + 1);

  let out = path;
  if (query !== null) {
    const q = scrubPart(query, mode);
    if (q) out += `?${q}`;
  }
  if (hash !== null) {
    const h = scrubPart(hash, mode);
    if (h) out += `#${h}`;
  }
  return out;
}

/** Vercel Analytics beforeSend: same event, scrubbed url. */
export function scrubAnalyticsEvent<T extends { url: string }>(event: T): T {
  return { ...event, url: scrubUrl(event.url) };
}
