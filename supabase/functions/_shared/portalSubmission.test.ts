import { describe, it, expect } from "vitest";
import {
  PORTAL_FIELD_LIMITS,
  PORTAL_INDUSTRIES,
  PORTAL_URGENCIES,
  PORTAL_WINDOWS,
  industryLabel,
  isPortalWindow,
  isSubmissionField,
  urgencyLabel,
  validateSubmission,
  windowSince,
} from "./portalSubmission";

const VALID = {
  companyName: "  Fresh Bakery ",
  contactName: " Ann ",
  email: " Ann@Fresh.example ",
  phone: "",
  address: " 5 Oak St ",
  industry: "restaurant",
  urgency: "this_week",
  notes: " Wants a demo ",
  consent: true,
  consentVersion: 3,
};

describe("validateSubmission", () => {
  it("trims, lowercases the email, and nulls blank optional fields", () => {
    expect(validateSubmission(VALID)).toEqual({
      ok: true,
      value: {
        companyName: "Fresh Bakery",
        contactName: "Ann",
        email: "ann@fresh.example",
        phone: null,
        address: "5 Oak St",
        industry: "restaurant",
        urgency: "this_week",
        notes: "Wants a demo",
        consent: true,
        consentVersion: 3,
      },
    });
  });

  it("accepts a phone without an email, and no industry, urgency or notes", () => {
    const res = validateSubmission({
      companyName: "Co",
      contactName: "Bo",
      phone: "(555) 010-0100",
      consent: true,
      consentVersion: 0,
    });
    expect(res).toEqual({
      ok: true,
      value: {
        companyName: "Co",
        contactName: "Bo",
        email: null,
        phone: "(555) 010-0100",
        address: null,
        industry: null,
        urgency: null,
        notes: "",
        consent: true,
        consentVersion: 0,
      },
    });
  });

  it.each([
    [{ companyName: "   " }, "companyName"],
    [{ companyName: "x".repeat(PORTAL_FIELD_LIMITS.companyName + 1) }, "companyName"],
    [{ contactName: "" }, "contactName"],
    [{ contactName: "x".repeat(PORTAL_FIELD_LIMITS.contactName + 1) }, "contactName"],
    [{ email: "not-an-email" }, "email"],
    [{ email: `${"x".repeat(250)}@a.co` }, "email"],
    [{ email: "", phone: "12" }, "phone"],
    [{ email: "", phone: "1".repeat(PORTAL_FIELD_LIMITS.phone + 1) }, "phone"],
    [{ email: "", phone: "" }, "emailOrPhone"],
    [{ address: "x".repeat(PORTAL_FIELD_LIMITS.address + 1) }, "address"],
    [{ industry: "casino" }, "industry"],
    [{ urgency: "asap" }, "urgency"],
    [{ notes: "x".repeat(PORTAL_FIELD_LIMITS.notes + 1) }, "notes"],
    [{ consent: false }, "consent"],
    [{ consent: "true" }, "consent"],
    [{ consentVersion: "3" }, "consent"],
    [{ consentVersion: 1.5 }, "consent"],
  ])("rejects %j as %s", (patch, field) => {
    expect(validateSubmission({ ...VALID, ...patch })).toEqual({ ok: false, field });
  });

  it("treats non-string values as blank", () => {
    expect(validateSubmission({ ...VALID, companyName: 42 })).toEqual({ ok: false, field: "companyName" });
  });
});

describe("lists and labels", () => {
  it("uses the Add Deal industry keys", () => {
    expect(PORTAL_INDUSTRIES.map((i) => i.value)).toEqual([
      "restaurant",
      "retail",
      "healthcare",
      "professional_services",
      "personal_services",
      "automotive",
      "other",
    ]);
    expect(industryLabel("professional_services")).toBe("Professional services");
    expect(industryLabel("nope")).toBeNull();
    expect(industryLabel(null)).toBeNull();
  });

  it("has three urgencies", () => {
    expect(PORTAL_URGENCIES.map((u) => u.label)).toEqual(["This week", "This month", "No rush"]);
    expect(urgencyLabel("no_rush")).toBe("No rush");
    expect(urgencyLabel(null)).toBeNull();
  });

  it("knows the submission field names", () => {
    expect(isSubmissionField("emailOrPhone")).toBe(true);
    expect(isSubmissionField("slug")).toBe(false);
    expect(isSubmissionField(undefined)).toBe(false);
  });
});

describe("windows", () => {
  const NOW = new Date("2026-10-12T15:00:00Z");

  it("offers 30 days, 90 days, 12 months, and all time", () => {
    expect(PORTAL_WINDOWS.map((w) => w.label)).toEqual(["30 days", "90 days", "12 months", "All time"]);
    expect(isPortalWindow("90d")).toBe(true);
    expect(isPortalWindow("7d")).toBe(false);
  });

  it("computes the start of each window", () => {
    expect(windowSince("30d", NOW)?.toISOString()).toBe("2026-09-12T15:00:00.000Z");
    expect(windowSince("90d", NOW)?.toISOString()).toBe("2026-07-14T15:00:00.000Z");
    expect(windowSince("12m", NOW)?.toISOString()).toBe("2025-10-12T15:00:00.000Z");
    expect(windowSince("all", NOW)).toBeNull();
  });

  it("does not mutate the clock it was given", () => {
    windowSince("30d", NOW);
    expect(NOW.toISOString()).toBe("2026-10-12T15:00:00.000Z");
  });
});
