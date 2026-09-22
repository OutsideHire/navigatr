import { describe, it, expect, vi, beforeEach } from "vitest";

const toastError = vi.fn();
const capture = vi.fn();

vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));
vi.mock("./observability", () => ({
  captureException: (e: unknown, c?: Record<string, unknown>) => capture(e, c),
}));

import { reportError } from "./reportError";

describe("reportError", () => {
  beforeEach(() => {
    toastError.mockClear();
    capture.mockClear();
  });

  it("shows the error's own message to the user", () => {
    reportError(new Error("Email rate limit exceeded"), {
      action: "auth.reset-password-request",
      fallback: "Couldn't send reset link",
    });
    expect(toastError).toHaveBeenCalledWith("Email rate limit exceeded");
  });

  it("falls back to the supplied copy when the value is not an Error", () => {
    reportError("something odd", {
      action: "auth.sign-in",
      fallback: "Sign in failed",
    });
    expect(toastError).toHaveBeenCalledWith("Sign in failed");
  });

  // The whole point: a caught error must ALSO reach Sentry. A user-visible
  // toast with no report is how the 2026-09-22 auth-email rate limit stayed
  // invisible to us for a week.
  it("reports the error to Sentry, tagged with the action", () => {
    const err = new Error("boom");
    reportError(err, { action: "auth.sign-up", fallback: "Sign up failed" });
    expect(capture).toHaveBeenCalledWith(err, { action: "auth.sign-up" });
  });

  it("passes extra context through to Sentry", () => {
    const err = new Error("boom");
    reportError(err, {
      action: "admin.invite-agent",
      fallback: "Could not send invite",
      extra: { count: 3 },
    });
    expect(capture).toHaveBeenCalledWith(err, { action: "admin.invite-agent", count: 3 });
  });

  it("still reports when the thrown value is not an Error", () => {
    reportError({ code: "PGRST204" }, { action: "auth.sign-in", fallback: "Sign in failed" });
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
