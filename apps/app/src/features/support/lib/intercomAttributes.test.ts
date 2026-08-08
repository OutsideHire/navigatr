// buildIntercomSettings. Pure mapper from our auth/profile shape to the
// Intercom Messenger boot object. Covers: created_at converted to UNIX
// seconds (and omitted for invalid/absent dates); user_hash present only
// when a non-null hash is supplied; null/undefined custom attributes
// omitted; and app_id/user_id/name/email passthrough.

import { describe, it, expect } from "vitest";
import { buildIntercomSettings, type BuildIntercomInput } from "./intercomAttributes";

function baseInput(overrides: Partial<BuildIntercomInput> = {}): BuildIntercomInput {
  return {
    appId: "abc123",
    userId: "user-1",
    name: "Jane Rep",
    email: "jane@navigatr.app",
    createdAtIso: "2024-01-02T03:04:05.000Z",
    userHash: "deadbeef",
    role: "manager",
    roleLevel: "sales_manager",
    orgId: "org-9",
    profession: "payroll",
    ...overrides,
  };
}

describe("buildIntercomSettings", () => {
  it("passes through app_id, user_id, name, email", () => {
    const s = buildIntercomSettings(baseInput());
    expect(s.app_id).toBe("abc123");
    expect(s.user_id).toBe("user-1");
    expect(s.name).toBe("Jane Rep");
    expect(s.email).toBe("jane@navigatr.app");
  });

  it("converts createdAtIso to UNIX seconds", () => {
    const s = buildIntercomSettings(baseInput({ createdAtIso: "2024-01-02T03:04:05.000Z" }));
    // 2024-01-02T03:04:05Z === 1704164645000 ms === 1704164645 s
    expect(s.created_at).toBe(1704164645);
  });

  it("omits created_at when the date is absent", () => {
    const s = buildIntercomSettings(baseInput({ createdAtIso: null }));
    expect("created_at" in s).toBe(false);
  });

  it("omits created_at when the date is invalid", () => {
    const s = buildIntercomSettings(baseInput({ createdAtIso: "not-a-date" }));
    expect("created_at" in s).toBe(false);
  });

  it("includes user_hash when a non-null hash is provided", () => {
    const s = buildIntercomSettings(baseInput({ userHash: "deadbeef" }));
    expect(s.user_hash).toBe("deadbeef");
  });

  it("omits the user_hash key entirely when the hash is null", () => {
    const s = buildIntercomSettings(baseInput({ userHash: null }));
    expect("user_hash" in s).toBe(false);
  });

  it("flattens custom attributes at the top level", () => {
    const s = buildIntercomSettings(baseInput());
    expect(s.role).toBe("manager");
    expect(s.role_level).toBe("sales_manager");
    expect(s.org_id).toBe("org-9");
    expect(s.profession).toBe("payroll");
  });

  it("omits custom attributes that are null or undefined", () => {
    const s = buildIntercomSettings(
      baseInput({ role: null, roleLevel: undefined, orgId: null, profession: null }),
    );
    expect("role" in s).toBe(false);
    expect("role_level" in s).toBe(false);
    expect("org_id" in s).toBe(false);
    expect("profession" in s).toBe(false);
    // The identity fields survive even when every custom attribute is missing.
    expect(s.app_id).toBe("abc123");
    expect(s.user_id).toBe("user-1");
  });

  it("omits email and name when absent, keeping the object minimal", () => {
    const s = buildIntercomSettings({
      appId: "abc123",
      userId: "user-1",
      name: null,
      email: null,
      createdAtIso: null,
      userHash: null,
      role: null,
      roleLevel: null,
      orgId: null,
      profession: null,
    });
    expect(s).toEqual({ app_id: "abc123", user_id: "user-1" });
  });
});
