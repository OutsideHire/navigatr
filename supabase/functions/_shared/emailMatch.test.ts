import { describe, it, expect } from "vitest";
import { classifyEmail, normalizeEmail, emailDomain, type EmailMatchInput } from "./emailMatch";

const base = {
  threadAlreadyCaptured: false,
  internalDomains: ["getnavigatr.io"],
  personalDomains: ["gmail.com", "outlook.com", "yahoo.com"],
  deals: [] as EmailMatchInput["deals"],
};

function input(over: Partial<EmailMatchInput>): EmailMatchInput {
  return { recipients: [], ...base, ...over };
}

describe("normalizeEmail / emailDomain", () => {
  it("lowercases + trims, extracts domain", () => {
    expect(normalizeEmail("  Jane@Acme.COM ")).toBe("jane@acme.com");
    expect(emailDomain("Jane@Acme.com")).toBe("acme.com");
    expect(emailDomain("nodomain")).toBe("");
  });
});

describe("classifyEmail", () => {
  it("thread dedup wins: already-captured thread -> duplicate", () => {
    expect(classifyEmail(input({ threadAlreadyCaptured: true, recipients: ["jane@acme.com"] })).kind).toBe("duplicate");
  });

  it("exact contact-email match -> matched (high confidence)", () => {
    const r = classifyEmail(input({
      recipients: ["Jane@Acme.com"],
      deals: [{ id: "d1", contactEmail: "jane@acme.com" }],
    }));
    expect(r).toEqual({ kind: "matched", dealId: "d1", confidence: 0.99, method: "contact_email" });
  });

  it("unique account-domain match -> matched (medium confidence)", () => {
    const r = classifyEmail(input({
      recipients: ["newperson@acme.com"],
      deals: [{ id: "d1", contactEmail: "jane@acme.com" }],
    }));
    expect(r).toEqual({ kind: "matched", dealId: "d1", confidence: 0.7, method: "account_domain" });
  });

  it("exact match takes precedence over domain match", () => {
    const r = classifyEmail(input({
      recipients: ["jane@acme.com"],
      deals: [
        { id: "d1", contactEmail: "jane@acme.com" },
        { id: "d2", contactEmail: "bob@acme.com" },
      ],
    }));
    expect(r.method).toBe("contact_email");
    expect(r.dealId).toBe("d1");
  });

  it("ambiguous domain (two deals same domain, no exact) -> unmatched", () => {
    const r = classifyEmail(input({
      recipients: ["newperson@acme.com"],
      deals: [
        { id: "d1", contactEmail: "jane@acme.com" },
        { id: "d2", contactEmail: "bob@acme.com" },
      ],
    }));
    expect(r).toEqual({ kind: "unmatched", reason: "ambiguous_domain" });
  });

  it("ambiguous exact (same email on two deals) -> unmatched, never guesses", () => {
    const r = classifyEmail(input({
      recipients: ["jane@acme.com"],
      deals: [
        { id: "d1", contactEmail: "jane@acme.com" },
        { id: "d2", contactEmail: "jane@acme.com" },
      ],
    }));
    expect(r).toEqual({ kind: "unmatched", reason: "ambiguous_contact" });
  });

  it("no candidate on a business domain -> unmatched", () => {
    const r = classifyEmail(input({
      recipients: ["someone@unknownco.com"],
      deals: [{ id: "d1", contactEmail: "jane@acme.com" }],
    }));
    expect(r).toEqual({ kind: "unmatched", reason: "no_candidate" });
  });

  it("internal-only recipients -> suppressed", () => {
    const r = classifyEmail(input({ recipients: ["teammate@getnavigatr.io"] }));
    expect(r).toEqual({ kind: "suppressed", reason: "internal_only" });
  });

  it("bulk send (>= threshold recipients) -> suppressed", () => {
    const many = Array.from({ length: 8 }, (_, i) => `p${i}@acme.com`);
    const r = classifyEmail(input({ recipients: many, deals: [{ id: "d1", contactEmail: "jane@acme.com" }] }));
    expect(r).toEqual({ kind: "suppressed", reason: "bulk" });
  });

  it("personal-domain-only send with no exact contact -> suppressed personal", () => {
    const r = classifyEmail(input({
      recipients: ["prospect@gmail.com"],
      deals: [{ id: "d1", contactEmail: "jane@acme.com" }],
    }));
    expect(r).toEqual({ kind: "suppressed", reason: "personal" });
  });

  it("personal-domain recipient that IS an exact contact -> still matched", () => {
    const r = classifyEmail(input({
      recipients: ["prospect@gmail.com"],
      deals: [{ id: "d1", contactEmail: "prospect@gmail.com" }],
    }));
    expect(r).toEqual({ kind: "matched", dealId: "d1", confidence: 0.99, method: "contact_email" });
  });

  it("drops internal recipients but still matches an external contact", () => {
    const r = classifyEmail(input({
      recipients: ["teammate@getnavigatr.io", "jane@acme.com"],
      deals: [{ id: "d1", contactEmail: "jane@acme.com" }],
    }));
    expect(r.kind).toBe("matched");
    expect(r.dealId).toBe("d1");
  });
});
