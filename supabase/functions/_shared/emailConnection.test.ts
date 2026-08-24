import { describe, it, expect } from "vitest";
import {
  emailConnectionRowForConnect,
  shouldRemoveEmailConnectionOnDisconnect,
} from "./emailConnection";

describe("emailConnectionRowForConnect", () => {
  const base = { orgId: "org1", userId: "u1", emailCaptureEnabled: true };

  it("provisions an outlook row when a Microsoft calendar connects with capture on", () => {
    expect(emailConnectionRowForConnect({ ...base, provider: "microsoft" })).toEqual({
      org_id: "org1",
      user_id: "u1",
      provider: "outlook",
      health: "ok",
      last_error: null,
    });
  });

  it("returns null when email capture is disabled", () => {
    expect(
      emailConnectionRowForConnect({ ...base, provider: "microsoft", emailCaptureEnabled: false }),
    ).toBeNull();
  });

  it("returns null for a non-Microsoft provider (Google calendar connect)", () => {
    expect(emailConnectionRowForConnect({ ...base, provider: "google" })).toBeNull();
  });

  it("omits capture_start_date so a reconnect never rewinds the no-backfill anchor", () => {
    const row = emailConnectionRowForConnect({ ...base, provider: "microsoft" })!;
    expect(row).not.toHaveProperty("capture_start_date");
  });
});

describe("shouldRemoveEmailConnectionOnDisconnect", () => {
  it("removes the mailbox row when Outlook (microsoft) disconnects", () => {
    expect(shouldRemoveEmailConnectionOnDisconnect("microsoft")).toBe(true);
  });
  it("leaves it alone for Google", () => {
    expect(shouldRemoveEmailConnectionOnDisconnect("google")).toBe(false);
  });
});
