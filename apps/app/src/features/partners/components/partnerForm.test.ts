import { describe, it, expect } from "vitest";
import {
  partnerFormSchema,
  editPartnerSchema,
  digitsOnly,
  formatUSPhone,
  stripUsCountryCode,
} from "./partnerForm";

const validAdd = {
  name: "Sarah Johnson",
  company: "Johnson & Boyle CPAs",
  type: "cpa" as const,
  phone: "(202) 555-0101",
  email: "sarah@jbcpa.com",
  city: "Austin, TX",
  notes: "Great CPA",
};

describe("partnerFormSchema", () => {
  it("accepts a fully valid partner", () => {
    expect(partnerFormSchema.safeParse(validAdd).success).toBe(true);
  });

  it("accepts a bare 10-digit phone and optional-empty city/notes", () => {
    const r = partnerFormSchema.safeParse({
      ...validAdd,
      phone: "2025550101",
      city: undefined,
      notes: undefined,
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing name", () => {
    expect(partnerFormSchema.safeParse({ ...validAdd, name: "" }).success).toBe(false);
  });

  it("rejects missing company", () => {
    expect(partnerFormSchema.safeParse({ ...validAdd, company: "" }).success).toBe(false);
  });

  it("rejects a short phone", () => {
    expect(partnerFormSchema.safeParse({ ...validAdd, phone: "555" }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(partnerFormSchema.safeParse({ ...validAdd, email: "nope" }).success).toBe(false);
  });
});

describe("editPartnerSchema", () => {
  it("requires a valid status on top of the add fields", () => {
    expect(
      editPartnerSchema.safeParse({ ...validAdd, status: "cooling", followupCadence: "none" })
        .success,
    ).toBe(true);
    expect(
      editPartnerSchema.safeParse({ ...validAdd, followupCadence: "none" }).success,
    ).toBe(false); // no status
    expect(
      editPartnerSchema.safeParse({ ...validAdd, status: "archived", followupCadence: "none" })
        .success,
    ).toBe(false); // bad status
  });
});

describe("phone helpers", () => {
  it("digitsOnly strips non-digits", () => {
    expect(digitsOnly("+1 (202) 555-0101")).toBe("12025550101");
  });

  it("formatUSPhone renders a US pattern and caps length", () => {
    expect(formatUSPhone("2025550101")).toBe("(202) 555-0101");
    expect(formatUSPhone("")).toBe("");
  });

  it("stripUsCountryCode drops a leading 1 only on 11-digit numbers", () => {
    expect(stripUsCountryCode("+12025550101")).toBe("2025550101");
    expect(stripUsCountryCode("2025550101")).toBe("2025550101");
  });
});

describe("editPartnerSchema — optional phone/email (unblock legacy edits)", () => {
  const validEdit = {
    name: "Sarah Johnson",
    company: "Johnson & Boyle CPAs",
    type: "cpa" as const,
    status: "active" as const,
    followupCadence: "none",
    phone: "",
    email: "",
    city: "",
    notes: "",
  };
  it("accepts empty phone AND empty email (a legacy partner missing both)", () => {
    expect(editPartnerSchema.safeParse(validEdit).success).toBe(true);
  });
  it("still forces phone format when a phone IS entered", () => {
    expect(editPartnerSchema.safeParse({ ...validEdit, phone: "555" }).success).toBe(false);
    expect(editPartnerSchema.safeParse({ ...validEdit, phone: "2025550101" }).success).toBe(true);
  });
  it("still forces email format when an email IS entered", () => {
    expect(editPartnerSchema.safeParse({ ...validEdit, email: "nope" }).success).toBe(false);
    expect(editPartnerSchema.safeParse({ ...validEdit, email: "a@b.com" }).success).toBe(true);
  });
});
