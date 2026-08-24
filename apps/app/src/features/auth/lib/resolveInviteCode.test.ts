import { describe, it, expect } from "vitest";
import { resolveInviteCode } from "./resolveInviteCode";

describe("resolveInviteCode", () => {
  it("prefers the URL invite over sessionStorage and user_metadata", () => {
    expect(
      resolveInviteCode({ urlInvite: "url", stashedInvite: "stash", metaInvite: "meta" }),
    ).toEqual({ code: "url", intentional: true });
  });

  it("falls back to sessionStorage when the URL has none", () => {
    expect(
      resolveInviteCode({ urlInvite: null, stashedInvite: "stash", metaInvite: "meta" }),
    ).toEqual({ code: "stash", intentional: true });
  });

  it("falls back to user_metadata when URL and sessionStorage are empty (new-tab confirm)", () => {
    // This is the fix: an invited rep confirming in a new tab has only the
    // metadata carrier, and it must still resolve to the invite.
    expect(
      resolveInviteCode({ urlInvite: null, stashedInvite: null, metaInvite: "tok_from_metadata" }),
    ).toEqual({ code: "tok_from_metadata", intentional: true });
  });

  it("returns no code + not-intentional when every carrier is empty", () => {
    expect(resolveInviteCode({})).toEqual({ code: "", intentional: false });
    expect(
      resolveInviteCode({ urlInvite: "", stashedInvite: "  ", metaInvite: null }),
    ).toEqual({ code: "", intentional: false });
  });

  it("trims whitespace-padded carriers", () => {
    expect(resolveInviteCode({ urlInvite: "  abc  " })).toEqual({ code: "abc", intentional: true });
  });
});
