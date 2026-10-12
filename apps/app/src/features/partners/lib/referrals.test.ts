import { describe, it, expect } from "vitest";
import {
  DECLINE_REASON_OPTIONS,
  REFERRAL_STATUS_BADGE,
  REFERRAL_STATUS_LABEL,
  canReassignReferrals,
  icpFlagLabels,
  isLiveLink,
  referralErrorMessage,
  type ReferralStatus,
} from "./referrals";

const ALL: ReferralStatus[] = ["submitted", "accepted", "working", "won", "lost", "declined", "withdrawn"];

describe("referral status labels", () => {
  it("labels every status with the internal (rep-facing) name", () => {
    expect(ALL.map((s) => REFERRAL_STATUS_LABEL[s])).toEqual([
      "Submitted", "Accepted", "Working", "Won", "Lost", "Declined", "Withdrawn",
    ]);
  });

  it("gives every status a badge kind", () => {
    for (const s of ALL) expect(REFERRAL_STATUS_BADGE[s]).toBeTruthy();
    expect(REFERRAL_STATUS_BADGE.won).toBe("stage-won");
  });
});

describe("isLiveLink", () => {
  it("treats declined and withdrawn as dead, everything else as live", () => {
    expect(ALL.filter(isLiveLink)).toEqual(["submitted", "accepted", "working", "won", "lost"]);
  });
});

describe("DECLINE_REASON_OPTIONS", () => {
  it("offers the six PRD reason codes in order", () => {
    expect(DECLINE_REASON_OPTIONS.map((o) => o.value)).toEqual([
      "duplicate", "outside_footprint", "outside_icp", "insufficient_contact",
      "existing_customer", "withdrawn_by_partner",
    ]);
    expect(DECLINE_REASON_OPTIONS[0]?.label).toBe("Duplicate of an existing opportunity");
  });
});

describe("referralErrorMessage", () => {
  it("maps server tokens to plain copy", () => {
    expect(referralErrorMessage({ message: "referral_not_submitted" }, "x")).toBe("This referral was already handled.");
    expect(referralErrorMessage({ message: "already_linked" }, "x")).toBe("That deal is already linked to this partner.");
    expect(referralErrorMessage(new Error("deal_not_visible"), "x")).toBe("You can't see that deal.");
    expect(referralErrorMessage({ message: "partner_not_visible" }, "x")).toBe("You can't see that partner.");
    expect(referralErrorMessage({ message: "invalid_direction" }, "x")).toBe("That link could not be removed.");
    expect(referralErrorMessage({ message: "not_authorized" }, "x")).toBe("You don't have access to do that.");
    expect(referralErrorMessage({ message: "company_required" }, "x")).toBe("Add the business name.");
    expect(referralErrorMessage({ message: "update_required" }, "x")).toBe("Write the update first.");
    expect(referralErrorMessage({ message: "update_too_long" }, "x")).toBe("Keep the update under 1,000 characters.");
  });

  it("falls back for unknown errors and non-errors", () => {
    expect(referralErrorMessage({ message: "boom" }, "Couldn't save")).toBe("Couldn't save");
    expect(referralErrorMessage(undefined, "Couldn't save")).toBe("Couldn't save");
  });
});

describe("canReassignReferrals", () => {
  it("matches the reassign_referral gate: manager or admin role, or administrator level", () => {
    expect(canReassignReferrals({ role: "manager", role_level: "sales_manager" })).toBe(true);
    expect(canReassignReferrals({ role: "admin", role_level: "administrator" })).toBe(true);
    expect(canReassignReferrals({ role: "rep", role_level: "administrator" })).toBe(true);
    expect(canReassignReferrals({ role: "rep", role_level: "sales_professional" })).toBe(false);
    expect(canReassignReferrals(null)).toBe(false);
    expect(canReassignReferrals(undefined)).toBe(false);
  });
});

describe("icpFlagLabels", () => {
  it("turns chain flags into advisory lines and drops anything else", () => {
    expect(icpFlagLabels(["chain:Subway", "chain:  ", "mystery:x", "chain:Starbucks"])).toEqual([
      "Looks like a chain: Subway",
      "Looks like a chain: Starbucks",
    ]);
    expect(icpFlagLabels(["chain:Ace Hardware Inc.", "chain:..."])).toEqual(["Looks like a chain: Ace Hardware Inc"]);
    expect(icpFlagLabels(null)).toEqual([]);
    expect(icpFlagLabels(undefined)).toEqual([]);
  });
});

describe("referralErrorMessage (Phase 2A)", () => {
  it("explains a refused reinstate", () => {
    expect(referralErrorMessage({ message: "referral_not_reinstatable" }, "fallback")).toBe(
      "This referral can't be reinstated now.",
    );
  });
});
