import { describe, it, expect } from "vitest";
import { PORTAL_STATUS_LABEL, functionErrorCode, portalAccessErrorMessage } from "./portalAccess";

describe("PORTAL_STATUS_LABEL", () => {
  it("labels every portal status", () => {
    expect(PORTAL_STATUS_LABEL).toEqual({
      invited: "Invited",
      active: "Active",
      suspended: "Suspended",
      revoked: "Revoked",
    });
  });
});

describe("portalAccessErrorMessage", () => {
  it("maps server tokens to plain copy", () => {
    expect(portalAccessErrorMessage(new Error("portal_disabled"))).toBe(
      "The partner portal is turned off. An admin can turn it on in Settings.",
    );
    expect(portalAccessErrorMessage({ message: "partner_email_required" })).toBe("Add an email for this partner first.");
    expect(portalAccessErrorMessage({ message: "portal_email_in_use" })).toBe(
      "Another partner already uses this email for the portal.",
    );
    expect(portalAccessErrorMessage({ message: "email_failed" })).toBe(
      "The invite was created but the email didn't send. Try Resend invite.",
    );
    expect(portalAccessErrorMessage({ message: "partner_not_visible" })).toBe("You don't have access to do that.");
    expect(portalAccessErrorMessage({ message: "invalid_transition" })).toBe(
      "Revoked access can't be suspended. Restore it first if you want to change it.",
    );
  });

  it("covers every code the portal_invite function can return", () => {
    for (const code of [
      "partner_email_required",
      "portal_disabled",
      "portal_already_active",
      "portal_email_in_use",
      "not_authorized",
      "partner_not_found",
      "invite_failed",
      "email_failed",
    ]) {
      expect(portalAccessErrorMessage({ message: code })).not.toBe("Something went wrong. Try again.");
    }
  });

  it("falls back for anything else", () => {
    expect(portalAccessErrorMessage(new Error("boom"))).toBe("Something went wrong. Try again.");
    expect(portalAccessErrorMessage(undefined)).toBe("Something went wrong. Try again.");
  });
});

describe("functionErrorCode", () => {
  it("reads the error token from an edge function error response", async () => {
    const error = { message: "non-2xx", context: new Response(JSON.stringify({ error: "portal_disabled" }), { status: 409 }) };
    await expect(functionErrorCode(error, "invite_failed")).resolves.toBe("portal_disabled");
  });

  it("falls back when there is no readable body", async () => {
    await expect(functionErrorCode({ message: "x" }, "invite_failed")).resolves.toBe("invite_failed");
    const html = { context: new Response("<html></html>", { status: 502 }) };
    await expect(functionErrorCode(html, "invite_failed")).resolves.toBe("invite_failed");
  });
});
