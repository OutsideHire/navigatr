/**
 * observability.test.ts — verifies the no-op-when-unconfigured contract
 * and the URL token-stripping behavior.
 *
 * Why these tests matter: the library is called from main.tsx and the
 * route error boundary. If a missing env var ever caused initObservability
 * to throw, the entire app would white-screen on load. The "no DSN = no
 * crash" guarantee is the load-bearing property.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We mock @sentry/react so the tests don't actually try to talk to Sentry.
// Each test imports observability.ts fresh via vi.resetModules() so the
// `initialized` flag doesn't bleed between cases.
vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({})),
}));

describe("observability", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initObservability is a no-op when VITE_SENTRY_DSN is unset", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const Sentry = await import("@sentry/react");
    const { initObservability } = await import("./observability");
    initObservability();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("initObservability calls Sentry.init when VITE_SENTRY_DSN is set", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability } = await import("./observability");
    initObservability();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const arg = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      dsn: "https://example@sentry.io/123",
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
    });
  });

  it("initObservability is idempotent — calling twice only inits once", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability } = await import("./observability");
    initObservability();
    initObservability();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });

  it("captureException is a no-op when uninitialized (does not throw)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const Sentry = await import("@sentry/react");
    const { captureException } = await import("./observability");
    expect(() => captureException(new Error("boom"))).not.toThrow();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("captureException forwards to Sentry when initialized", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability, captureException } = await import("./observability");
    initObservability();
    const err = new Error("boom");
    captureException(err, { componentStack: "x" });
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      extra: { componentStack: "x" },
    });
  });

  it("captureException drops an expected Supabase permission error (authz noise)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability, captureException } = await import("./observability");
    initObservability();
    captureException({ code: "P0001", message: "forbidden", details: null, hint: null }, { source: "react-query" });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("captureException normalizes a raw Supabase error into a readable Error", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability, captureException } = await import("./observability");
    initObservability();
    captureException({ code: "23505", message: "duplicate key value", details: "d", hint: null }, { source: "react-query" });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBeInstanceOf(Error);
    expect((call[0] as Error).message).toBe("[23505] duplicate key value");
    expect((call[1] as { extra: Record<string, unknown> }).extra).toMatchObject({
      supabase_code: "23505",
      source: "react-query",
    });
  });

  it("reportCacheError reports a non-offline error tagged by its source", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability, reportCacheError } = await import("./observability");
    initObservability();
    const err = new Error("read failed");
    reportCacheError("react-query")(err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { extra: { source: "react-query" } });
  });

  it("reportCacheError tags a mutation failure with the mutation source (closes the report gap)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability, reportCacheError } = await import("./observability");
    initObservability();
    reportCacheError("react-query-mutation")(new Error("save failed"));
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { source: "react-query-mutation" },
    });
  });

  it("reportCacheError skips offline errors (expected + noisy)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability, reportCacheError } = await import("./observability");
    initObservability();
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    try {
      reportCacheError("react-query")(new Error("offline"));
      expect(Sentry.captureException).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    }
  });

  it("init registers the environmental noise patterns in ignoreErrors", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability } = await import("./observability");
    initObservability();
    const arg = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { ignoreErrors: string[] };
    expect(arg.ignoreErrors).toEqual(
      expect.arrayContaining([
        "Failed to fetch dynamically imported module",
        "LockManager lock",
        "Object Not Found Matching Id",
        "Failed to update a ServiceWorker",
      ]),
    );
  });

  it("setUser tags user and org when initialized", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability, setUser } = await import("./observability");
    initObservability();
    setUser({ id: "user-1", orgId: "org-1" });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: "user-1" });
    expect(Sentry.setTag).toHaveBeenCalledWith("org_id", "org-1");
  });

  it("setUser(null) clears user and org tag", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability, setUser } = await import("./observability");
    initObservability();
    setUser(null);
    expect(Sentry.setUser).toHaveBeenCalledWith(null);
    expect(Sentry.setTag).toHaveBeenCalledWith("org_id", undefined);
  });

  it("beforeSend strips PII (emails + phones) from event payloads", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability } = await import("./observability");
    initObservability();
    const initArg = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      beforeSend: (e: Record<string, unknown>) => Record<string, unknown>;
    };
    const event = {
      message: "User user@example.com hit error at +15551234567",
      exception: {
        values: [{ value: "deal owner alice@acme.com (555) 123-4567 not found" }],
      },
      extra: { customer_email: "lead@example.com" },
    };
    const out = initArg.beforeSend(event);
    expect((out.message as string)).not.toContain("user@example.com");
    expect((out.message as string)).toContain("[email]");
    expect((out.message as string)).not.toContain("+15551234567");
    expect((out.message as string)).toContain("[phone]");
    const exceptionValue = (out.exception as { values: { value: string }[] }).values[0].value;
    expect(exceptionValue).toContain("[email]");
    expect(exceptionValue).toContain("[phone]");
    expect((out.extra as { customer_email: string }).customer_email).toBe("[email]");
  });

  it("beforeSend strips token-ish query params from request URL", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability } = await import("./observability");
    initObservability();
    const initArg = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      beforeSend: (e: { request?: { url?: string } }) => unknown;
    };
    const event = {
      request: { url: "https://app.example/accept-invite?token=SECRET123&page=2" },
    };
    initArg.beforeSend(event);
    expect(event.request.url).toContain("token=%5Bredacted%5D");
    expect(event.request.url).not.toContain("SECRET123");
    expect(event.request.url).toContain("page=2");
  });

  it("beforeSend normalizes an UNHANDLED raw Supabase error (via hint) and scrubs PII in the rewritten value + extra", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability } = await import("./observability");
    initObservability();
    const initArg = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      beforeSend: (e: Record<string, unknown>, h?: { originalException?: unknown }) => Record<string, unknown> | null;
    };
    // The synthesized event Sentry builds from a raw-object unhandled rejection.
    const event = {
      exception: { values: [{ type: "Error", value: "Object captured as exception with keys: code, details, hint, message" }] },
    };
    const raw = { code: "23514", message: "value violates check for lead@acme.com", details: "row for owner@iso.com", hint: null };
    const out = initArg.beforeSend(event, { originalException: raw }) as Record<string, unknown>;
    const val = (out.exception as { values: { type: string; value: string }[] }).values[0];
    expect(val.type).toBe("SupabaseError");
    expect(val.value).toContain("[23514]");
    expect(val.value).toContain("[email]");            // PII scrubbed in the title
    expect(val.value).not.toContain("lead@acme.com");
    expect((out.extra as { supabase_details: string }).supabase_details).toBe("row for [email]"); // and in extra
    expect(out.fingerprint).toBeUndefined();           // no fingerprint carrying the raw message
  });

  it("beforeSend drops an UNHANDLED expected-permission Supabase error (P0001 forbidden)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability } = await import("./observability");
    initObservability();
    const initArg = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      beforeSend: (e: Record<string, unknown>, h?: { originalException?: unknown }) => Record<string, unknown> | null;
    };
    const out = initArg.beforeSend(
      { exception: { values: [{ value: "Object captured as exception with keys: code, details, hint, message" }] } },
      { originalException: { code: "P0001", message: "forbidden", details: null, hint: null } },
    );
    expect(out).toBeNull();
  });

  it("beforeSend scrubs PII from a fingerprint (defense-in-depth for any custom grouping key)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://example@sentry.io/123");
    const Sentry = await import("@sentry/react");
    const { initObservability } = await import("./observability");
    initObservability();
    const initArg = (Sentry.init as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      beforeSend: (e: Record<string, unknown>) => Record<string, unknown>;
    };
    const event = { fingerprint: ["supabase", "P0001", "invalid email lead@acme.com"] };
    const out = initArg.beforeSend(event);
    const fp = out.fingerprint as string[];
    expect(fp.some((s) => s.includes("lead@acme.com"))).toBe(false);
    expect(fp.some((s) => s.includes("[email]"))).toBe(true);
  });
});
