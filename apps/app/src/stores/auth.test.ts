import { describe, it, expect, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

// Importing the store runs a module-level auth bootstrap (getSession +
// onAuthStateChange). Stub the SDK so that side effect is inert and these stay
// pure-helper unit tests with no network.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

import {
  getFullName,
  getFirstName,
  getProfession,
  getRole,
  canInviteTeam,
  hasDismissedOnboarding,
} from "./auth";

/** Minimal User-shaped fixture: the helpers only read user_metadata + email. */
function user(meta: Record<string, unknown> = {}, email?: string): User {
  return { user_metadata: meta, email } as unknown as User;
}

describe("getFullName", () => {
  it("uses full_name when present, trimmed", () => {
    expect(getFullName(user({ full_name: "  Jane Doe  " }))).toBe("Jane Doe");
  });
  it("falls back to email when full_name is missing", () => {
    expect(getFullName(user({}, "jane@navigatr.app"))).toBe("jane@navigatr.app");
  });
  it("falls back to 'there' with neither name nor email, and for a null user", () => {
    expect(getFullName(user({}))).toBe("there");
    expect(getFullName(null)).toBe("there");
  });
});

describe("getFirstName", () => {
  it("takes the first token of a full name", () => {
    expect(getFirstName(user({ full_name: "Jane Doe" }))).toBe("Jane");
  });
  it("capitalizes the local part of an email fallback", () => {
    expect(getFirstName(user({}, "jane@navigatr.app"))).toBe("Jane");
  });
  it("strips a + subaddressing tag from an email", () => {
    expect(getFirstName(user({}, "jane+work@gmail.com"))).toBe("Jane");
    expect(getFirstName(user({}, "test+1778591756@x.io"))).toBe("Test");
  });
  it("returns 'there' when there is no name and no email", () => {
    expect(getFirstName(null)).toBe("there");
  });
});

describe("getProfession", () => {
  it("returns a valid profession", () => {
    expect(getProfession(user({ profession: "payroll" }))).toBe("payroll");
    expect(getProfession(user({ profession: "merchant_services" }))).toBe("merchant_services");
  });
  it("returns null for an unknown or missing profession", () => {
    expect(getProfession(user({ profession: "astronaut" }))).toBeNull();
    expect(getProfession(user({}))).toBeNull();
    expect(getProfession(null)).toBeNull();
  });
});

describe("getRole", () => {
  it("returns a valid role", () => {
    expect(getRole(user({ role: "vp" }))).toBe("vp");
    expect(getRole(user({ role: "admin" }))).toBe("admin");
  });
  it("returns null for an unknown or missing role", () => {
    expect(getRole(user({ role: "wizard" }))).toBeNull();
    expect(getRole(user({}))).toBeNull();
    expect(getRole(null)).toBeNull();
  });
});

describe("canInviteTeam", () => {
  it("allows a user with no role set yet (self-signup owner defaults to admin)", () => {
    expect(canInviteTeam(user({}))).toBe(true);
    expect(canInviteTeam(null)).toBe(true);
  });
  it("denies a sales_professional", () => {
    expect(canInviteTeam(user({ role: "sales_professional" }))).toBe(false);
  });
  it("allows any role above sales_professional", () => {
    expect(canInviteTeam(user({ role: "territory_manager" }))).toBe(true);
    expect(canInviteTeam(user({ role: "admin" }))).toBe(true);
  });
});

describe("hasDismissedOnboarding", () => {
  it("is true once a dismissal timestamp is set", () => {
    expect(hasDismissedOnboarding(user({ onboarding_dismissed_at: "2026-08-28T00:00:00Z" }))).toBe(true);
  });
  it("is false when unset, empty, or for a null user", () => {
    expect(hasDismissedOnboarding(user({}))).toBe(false);
    expect(hasDismissedOnboarding(user({ onboarding_dismissed_at: "" }))).toBe(false);
    expect(hasDismissedOnboarding(null)).toBe(false);
  });
});
