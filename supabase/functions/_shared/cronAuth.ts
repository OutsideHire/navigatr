/**
 * Shared authorization guard for the cron-invoked snapshot functions.
 *
 * compute_coverage_snapshots and compute_persistence_snapshots run with the
 * service-role key and read/write snapshot rows for EVERY org, bypassing RLS.
 * They were declared as `Deno.serve(async () => {...})` with the request never
 * bound, so they performed no caller check at all.
 *
 * Platform `verify_jwt` is NOT an authorization boundary for them:
 *   - it validates signature + expiry only, and does not require role != anon;
 *   - the legacy anon key is itself a JWT signed with the project's JWT secret
 *     (which is why supabase.functions.invoke works from a logged-out browser),
 *     and it ships in the client bundle;
 *   - independently of that, any logged-in rep holds a genuine user JWT that
 *     clears the gate outright.
 *
 * The schedulers already send the right credential. Both *_snapshot_cron.sql
 * migrations do `net.http_post(..., 'Authorization', 'Bearer ' ||
 * <service_role_key from Vault>, ...)`; the functions just never verified it.
 * These helpers make them verify, so no scheduling change is needed.
 *
 * Plain dependency-free TS (no Deno globals at module scope) so the app's vitest
 * run unit-tests it, matching the other _shared modules. `Response` and
 * `TextEncoder` are web standards present in both Deno and Node 20.
 */

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/**
 * The only thing the guard needs from a request. Narrower than `Request` so the
 * unit tests can pass a plain object instead of depending on a `Request` global
 * being present under vitest's jsdom environment. A real `Request` satisfies it.
 */
export interface HeaderBearingRequest {
  headers: { get(name: string): string | null };
}

/**
 * Extract the token from an `Authorization: Bearer <token>` header. Returns ""
 * for a missing, malformed, or non-Bearer header so callers get one falsy
 * "no credential" shape instead of having to special-case null vs "".
 */
export function bearerToken(header: string | null | undefined): string {
  if (!header) return "";
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

/**
 * Compare two strings without leaking WHERE they differ via timing.
 *
 * Length is compared up front and is not treated as secret: the service-role
 * key's length is a public property of the token format, and the loop needs
 * equal-length buffers. What must not leak is the position of the first
 * differing byte, which an early `return false` inside the loop would reveal.
 */
export function timingSafeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

/**
 * Gate a cron-only endpoint. Returns a Response to send back when the caller is
 * not authorized, or null when the request may proceed:
 *
 *   const denied = requireCronCaller(req, SERVICE_ROLE_KEY);
 *   if (denied) return denied;
 *
 * Fails closed on misconfiguration: if the expected secret is missing or blank
 * (e.g. the env var was never set), every caller is rejected rather than
 * accidentally comparing against "" and letting a blank bearer through. That
 * case returns 503 rather than 401 so a deploy mistake is distinguishable from
 * an unauthorized caller in the logs, while still denying the request.
 */
export function requireCronCaller(
  req: HeaderBearingRequest,
  expectedSecret: string | null | undefined,
): Response | null {
  if (!expectedSecret) {
    return new Response(JSON.stringify({ error: "cron credential not configured" }), {
      status: 503,
      headers: JSON_HEADERS,
    });
  }
  const provided = bearerToken(req.headers.get("Authorization"));
  if (!provided || !timingSafeEquals(provided, expectedSecret)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }
  return null;
}
