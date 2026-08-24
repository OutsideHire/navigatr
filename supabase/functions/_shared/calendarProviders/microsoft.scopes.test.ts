import { describe, it, expect } from "vitest";
import { buildMicrosoftScopes, microsoftProvider } from "./microsoft";

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
