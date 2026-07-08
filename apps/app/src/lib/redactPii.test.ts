/**
 * redactPii.test.ts — focused unit tests for the PII redaction helpers
 * in observability.ts.
 *
 * These tests do NOT touch Sentry. They exercise the pure-function shape
 * of redactString + redactPii directly, which is exactly what runs inside
 * the beforeSend hook in production.
 */
import { describe, it, expect, vi } from "vitest";

// The Sentry SDK is imported transitively (observability.ts → @sentry/react).
// Stub it so the test runs without Sentry doing any side-effect imports.
vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({})),
}));

import { redactString, redactPii } from "./observability";

describe("redactString", () => {
  it("masks a single email address", () => {
    expect(redactString("error from user@example.com")).toBe("error from [email]");
  });

  it("masks multiple emails in one string", () => {
    expect(redactString("a@x.io and b@y.io conflict")).toBe("[email] and [email] conflict");
  });

  it("masks E.164 phone numbers", () => {
    expect(redactString("call +15551234567 now")).toBe("call [phone] now");
  });

  it("masks US-formatted phone numbers", () => {
    expect(redactString("(555) 123-4567")).toBe("[phone]");
    expect(redactString("555-123-4567")).toBe("[phone]");
    expect(redactString("555.123.4567")).toBe("[phone]");
  });

  it("does NOT mask plain long integers (deal IDs, timestamps)", () => {
    // The phone regex requires explicit separators so a 13-digit deal ID
    // doesn't get falsely redacted.
    expect(redactString("deal 5551234567890 is stale")).toBe("deal 5551234567890 is stale");
    expect(redactString("ts 1716843297")).toBe("ts 1716843297");
  });

  it("leaves non-PII strings untouched", () => {
    expect(redactString("the cache key foo:bar:42 is stale")).toBe(
      "the cache key foo:bar:42 is stale",
    );
  });

  it("redacts email + phone together in one message", () => {
    const out = redactString("contact user@example.com or +15551234567");
    expect(out).toBe("contact [email] or [phone]");
  });
});

describe("redactPii", () => {
  it("masks message field", () => {
    const event = { message: "User user@example.com missing" };
    const out = redactPii(event);
    expect(out.message).toBe("User [email] missing");
  });

  it("masks nested exception.values[].value", () => {
    const event = {
      exception: {
        values: [
          { value: "deal owner alice@acme.com not found" },
          { value: "callback to (555) 123-4567 failed" },
        ],
      },
    };
    const out = redactPii(event);
    const values = (out.exception as { values: { value: string }[] }).values;
    expect(values[0].value).toBe("deal owner [email] not found");
    expect(values[1].value).toBe("callback to [phone] failed");
  });

  it("walks deeply nested extra payloads", () => {
    const event = {
      extra: {
        user: { email: "x@y.com", phone: "+15551234567" },
        deal: { contact: { email: "z@w.com" } },
      },
    };
    const out = redactPii(event) as { extra: { user: { email: string; phone: string }; deal: { contact: { email: string } } } };
    expect(out.extra.user.email).toBe("[email]");
    expect(out.extra.user.phone).toBe("[phone]");
    expect(out.extra.deal.contact.email).toBe("[email]");
  });

  it("walks arrays of strings", () => {
    const event = {
      breadcrumbs: [
        { message: "user a@b.com clicked", data: { phone: "+15551234567" } },
      ],
    };
    const out = redactPii(event) as { breadcrumbs: { message: string; data: { phone: string } }[] };
    expect(out.breadcrumbs[0].message).toBe("user [email] clicked");
    expect(out.breadcrumbs[0].data.phone).toBe("[phone]");
  });

  it("does not crash on circular references", () => {
    const event: Record<string, unknown> = { message: "test" };
    const circular: Record<string, unknown> = { self: null };
    circular.self = circular; // self-reference
    event.extra = circular;
    expect(() => redactPii(event)).not.toThrow();
  });

  it("preserves non-string scalars (numbers, booleans, null, undefined)", () => {
    const event = {
      extra: {
        count: 42,
        ok: true,
        nothing: null,
        missing: undefined,
        name: "alice@acme.com",
      },
    };
    const out = redactPii(event) as { extra: { count: number; ok: boolean; nothing: null; missing: undefined; name: string } };
    expect(out.extra.count).toBe(42);
    expect(out.extra.ok).toBe(true);
    expect(out.extra.nothing).toBeNull();
    expect(out.extra.missing).toBeUndefined();
    expect(out.extra.name).toBe("[email]");
  });

  it("does not crash when expected fields are missing", () => {
    expect(() => redactPii({})).not.toThrow();
    expect(() => redactPii({ message: undefined })).not.toThrow();
  });
});
