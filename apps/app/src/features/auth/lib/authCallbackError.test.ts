import { describe, it, expect } from "vitest";
import { parseAuthCallbackError } from "./authCallbackError";

const q = (s = "") => new URLSearchParams(s);

describe("parseAuthCallbackError", () => {
  it("returns a friendly expired-link message for otp_expired in the URL hash", () => {
    const msg = parseAuthCallbackError(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      q(),
    );
    expect(msg).toMatch(/expired or is no longer valid/i);
  });

  it("also reads the error from the query string (some flows use it)", () => {
    expect(parseAuthCallbackError("", q("error_code=otp_expired"))).toMatch(/expired/i);
  });

  it("treats the Supabase email-link description ('invalid or has expired') as an expired link", () => {
    expect(
      parseAuthCallbackError("#error=access_denied&error_description=Email+link+is+invalid+or+has+expired", q()),
    ).toMatch(/expired or is no longer valid/i);
  });

  it("does NOT label a bare 'invalid' error (e.g. OAuth invalid_grant) as expired", () => {
    // "invalid" alone is not an expiry, and "request a new one" is the wrong
    // remedy, so it falls through to the generic branch.
    expect(parseAuthCallbackError("#error=invalid_grant&error_description=Invalid+grant", q())).toBe(
      "We could not sign you in: Invalid grant",
    );
  });

  it("surfaces the provider description for other error codes", () => {
    expect(parseAuthCallbackError("#error=server_error&error_description=Something+went+wrong", q())).toBe(
      "We could not sign you in: Something went wrong",
    );
  });

  it("gives a generic invalid-link message when an error has no description", () => {
    expect(parseAuthCallbackError("#error=access_denied", q())).toMatch(/no longer valid/i);
  });

  it("returns null when there is no error param (a normal token callback)", () => {
    expect(parseAuthCallbackError("#access_token=abc&type=magiclink", q())).toBeNull();
    expect(parseAuthCallbackError("", q())).toBeNull();
  });
});
