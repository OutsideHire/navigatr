import { describe, it, expect, afterEach, vi } from "vitest";
import { buildMicrosoftScopes, microsoftProvider, emailCaptureEnabledFromEnv } from "./microsoft";

describe("buildMicrosoftScopes", () => {
  const BASE = ["offline_access", "openid", "profile", "email", "User.Read", "Calendars.ReadWrite"];

  it("returns exactly the base calendar scopes when email capture is off", () => {
    expect(buildMicrosoftScopes(false)).toEqual(BASE);
    expect(buildMicrosoftScopes(false)).not.toContain("Mail.ReadBasic");
  });

  it("adds Mail.ReadBasic (and keeps all base scopes) when email capture is on", () => {
    const scopes = buildMicrosoftScopes(true);
    expect(scopes).toContain("Mail.ReadBasic");
    for (const s of BASE) expect(scopes).toContain(s);
    // Read-only metadata scope only; never the heavier Mail.Read/ReadWrite.
    expect(scopes).not.toContain("Mail.Read");
    expect(scopes).not.toContain("Mail.ReadWrite");
  });

  it("provider default (no Deno env in vitest) is calendar-only, so prod OAuth is unchanged", () => {
    // Under Node/vitest there is no Deno env, so the flag resolves false.
    expect(microsoftProvider.oauth.scopes).toEqual(BASE);
  });
});

describe("emailCaptureEnabledFromEnv (cross-runtime flag read)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("false when there is no Deno global (Node/vitest)", () => {
    expect(emailCaptureEnabledFromEnv()).toBe(false);
  });

  it("true only when Deno env EMAIL_CAPTURE_ENABLED is exactly '1'", () => {
    vi.stubGlobal("Deno", { env: { get: (k: string) => (k === "EMAIL_CAPTURE_ENABLED" ? "1" : undefined) } });
    expect(emailCaptureEnabledFromEnv()).toBe(true);
  });

  it("false for any other Deno env value", () => {
    vi.stubGlobal("Deno", { env: { get: () => "0" } });
    expect(emailCaptureEnabledFromEnv()).toBe(false);
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    expect(emailCaptureEnabledFromEnv()).toBe(false);
  });
});
