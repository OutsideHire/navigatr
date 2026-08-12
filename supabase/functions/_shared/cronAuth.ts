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
 * WHAT THE CREDENTIAL IS, AND WHY IT IS NOT THE SERVICE-ROLE KEY.
 *
 * The first version of this guard compared the bearer against
 * SUPABASE_SERVICE_ROLE_KEY, because the schedulers already sent that. It was
 * deployed on 2026-08-12 and immediately rejected the schedulers' own requests
 * with 401: the Vault copy is a valid original service_role JWT, but it is not
 * byte-identical to what Supabase now injects into that variable (new-format
 * `sb_secret_*` keys coexist with the legacy JWTs). An exact string comparison
 * against a platform-managed value fails the moment the platform changes it,
 * and it fails silently, because a skipped nightly job produces no error anyone
 * sees. That is a bad property for a job nobody watches.
 *
 * So the credential is CRON_SECRET, a value we own:
 *   - set as an Edge Function secret, read here;
 *   - stored in Vault as `cron_secret`, sent by both *_snapshot_cron.sql jobs;
 *   - nothing Supabase does to key formats can invalidate it.
 *
 * It also shrinks the blast radius. The service-role key grants full database
 * access bypassing every RLS policy; using it to answer "is this the scheduler?"
 * put a full-access credential in the cron job definition to settle a yes/no
 * question. CRON_SECRET grants nothing on its own.
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
