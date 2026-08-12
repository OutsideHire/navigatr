import { describe, it, expect } from "vitest";
import { bearerToken, timingSafeEquals, requireCronCaller } from "./cronAuth";

/** Minimal stand-in for a Request, matching HeaderBearingRequest. */
function reqWithAuth(value: string | null) {
  return { headers: { get: (name: string) => (name.toLowerCase() === "authorization" ? value : null) } };
}

const SERVICE_ROLE_KEY = "sbp_service_role_key_abcdefghijklmnopqrstuvwxyz0123456789";

describe("bearerToken", () => {
  it("extracts the token from a well-formed header", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
  });
  it("is case-insensitive on the scheme", () => {
    expect(bearerToken("bearer abc123")).toBe("abc123");
    expect(bearerToken("BEARER abc123")).toBe("abc123");
  });
  it("tolerates surrounding and extra internal whitespace", () => {
    expect(bearerToken("  Bearer   abc123  ")).toBe("abc123");
    expect(bearerToken("Bearer\tabc123")).toBe("abc123");
  });
  it("returns empty string for a missing header", () => {
    expect(bearerToken(null)).toBe("");
    expect(bearerToken(undefined)).toBe("");
    expect(bearerToken("")).toBe("");
  });
  it("returns empty string for a non-Bearer scheme", () => {
    expect(bearerToken("Basic abc123")).toBe("");
    expect(bearerToken("abc123")).toBe("");
  });
  it("returns empty string when Bearer has no token", () => {
    expect(bearerToken("Bearer")).toBe("");
    expect(bearerToken("Bearer   ")).toBe("");
  });
  it("keeps a JWT's dots and dashes intact", () => {
    expect(bearerToken("Bearer eyJhbG.eyJyb2xl.sig-nature_x")).toBe("eyJhbG.eyJyb2xl.sig-nature_x");
  });
});

describe("timingSafeEquals", () => {
  it("is true for identical strings", () => {
    expect(timingSafeEquals(SERVICE_ROLE_KEY, SERVICE_ROLE_KEY)).toBe(true);
    expect(timingSafeEquals("", "")).toBe(true);
  });
  it("is false for same-length strings differing in one byte", () => {
    expect(timingSafeEquals("abcdef", "abcdeg")).toBe(false);
    // Differing in the FIRST byte must behave the same as the last.
    expect(timingSafeEquals("abcdef", "zbcdef")).toBe(false);
  });
  it("is false for different lengths", () => {
    expect(timingSafeEquals("abc", "abcd")).toBe(false);
    expect(timingSafeEquals("abcd", "abc")).toBe(false);
    expect(timingSafeEquals("", "a")).toBe(false);
  });
  it("compares by bytes, not code units, for multi-byte input", () => {
    expect(timingSafeEquals("é", "é")).toBe(true);
    expect(timingSafeEquals("é", "e")).toBe(false);
  });
});

describe("requireCronCaller", () => {
  it("allows the request through when the bearer matches the expected secret", () => {
    const denied = requireCronCaller(reqWithAuth(`Bearer ${SERVICE_ROLE_KEY}`), SERVICE_ROLE_KEY);
    expect(denied).toBeNull();
  });

  // The actual vulnerability: both snapshot functions were declared as
  // `Deno.serve(async () => {...})`, so ANY caller that cleared the platform
  // verify_jwt gate ran the platform-wide, RLS-bypassing job. verify_jwt is
  // cleared by the public anon key (itself a project-signed JWT that ships in
  // the browser bundle) and by any logged-in rep's user JWT. Neither is the
  // cron credential, so both must now be rejected.
  it("rejects the public anon key", () => {
    const anonKey = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.publicsignature";
    const denied = requireCronCaller(reqWithAuth(`Bearer ${anonKey}`), SERVICE_ROLE_KEY);
    expect(denied?.status).toBe(401);
  });
  it("rejects a logged-in user's JWT", () => {
    const userJwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCIsInN1YiI6InJlcCJ9.sig";
    const denied = requireCronCaller(reqWithAuth(`Bearer ${userJwt}`), SERVICE_ROLE_KEY);
    expect(denied?.status).toBe(401);
  });

  it("rejects a missing Authorization header", () => {
    expect(requireCronCaller(reqWithAuth(null), SERVICE_ROLE_KEY)?.status).toBe(401);
  });
  it("rejects a non-Bearer scheme carrying the right value", () => {
    expect(requireCronCaller(reqWithAuth(`Basic ${SERVICE_ROLE_KEY}`), SERVICE_ROLE_KEY)?.status).toBe(401);
  });
  it("rejects a bearer that is a prefix of the secret", () => {
    const prefix = SERVICE_ROLE_KEY.slice(0, -1);
    expect(requireCronCaller(reqWithAuth(`Bearer ${prefix}`), SERVICE_ROLE_KEY)?.status).toBe(401);
  });
  it("rejects an empty bearer token", () => {
    expect(requireCronCaller(reqWithAuth("Bearer "), SERVICE_ROLE_KEY)?.status).toBe(401);
  });

  // Fail closed on misconfiguration. The dangerous bug would be an unset env
  // var collapsing to "" and then matching a blank/absent bearer.
  it("rejects everyone with 503 when the expected secret is unset", () => {
    expect(requireCronCaller(reqWithAuth("Bearer anything"), undefined)?.status).toBe(503);
    expect(requireCronCaller(reqWithAuth("Bearer anything"), null)?.status).toBe(503);
    expect(requireCronCaller(reqWithAuth("Bearer anything"), "")?.status).toBe(503);
  });
  it("does not let a blank bearer match a blank secret", () => {
    expect(requireCronCaller(reqWithAuth("Bearer "), "")?.status).toBe(503);
    expect(requireCronCaller(reqWithAuth(null), "")?.status).toBe(503);
  });

  it("returns a JSON body on denial", async () => {
    const denied = requireCronCaller(reqWithAuth(null), SERVICE_ROLE_KEY);
    expect(denied?.headers.get("Content-Type")).toBe("application/json");
    expect(await denied?.json()).toEqual({ error: "unauthorized" });
  });
  it("does not echo the provided or expected credential in the body", async () => {
    const denied = requireCronCaller(reqWithAuth("Bearer leaked-attempt"), SERVICE_ROLE_KEY);
    const body = await denied?.text();
    expect(body).not.toContain("leaked-attempt");
    expect(body).not.toContain(SERVICE_ROLE_KEY);
  });
});
