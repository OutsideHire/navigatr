import { describe, it, expect } from "vitest";
import {
  summarizeRecipients,
  buildEmailSuggestionViews,
  type EmailSuggestionRow,
} from "./emailSuggestions";

describe("summarizeRecipients", () => {
  it("returns empty string for none", () => {
    expect(summarizeRecipients(null)).toBe("");
    expect(summarizeRecipients([])).toBe("");
    expect(summarizeRecipients(["  "])).toBe("");
  });
  it("returns the single recipient verbatim", () => {
    expect(summarizeRecipients(["jane@acme.com"])).toBe("jane@acme.com");
  });
  it("appends +N for additional recipients", () => {
    expect(summarizeRecipients(["jane@acme.com", "bob@acme.com", "x@acme.com"]))
      .toBe("jane@acme.com +2");
  });
});

function row(over: Partial<EmailSuggestionRow> & { id: string }): EmailSuggestionRow {
  return {
    subject: "Proposal",
    recipients: ["jane@acme.com"],
    sent_at: "2026-08-20T10:00:00.000Z",
    matched_deal_id: "d1",
    deep_link_url: "https://outlook/1",
    ...over,
  };
}

describe("buildEmailSuggestionViews", () => {
  const names = new Map([["d1", "Acme Co"]]);

  it("joins the deal company name and passes fields through", () => {
    const [v] = buildEmailSuggestionViews([row({ id: "e1" })], names);
    expect(v).toEqual({
      id: "e1",
      subject: "Proposal",
      recipientSummary: "jane@acme.com",
      sentAt: "2026-08-20T10:00:00.000Z",
      dealId: "d1",
      companyName: "Acme Co",
      deepLinkUrl: "https://outlook/1",
    });
  });

  it("falls back to (no subject) for a blank/absent subject", () => {
    expect(buildEmailSuggestionViews([row({ id: "e1", subject: null })], names)[0].subject)
      .toBe("(no subject)");
    expect(buildEmailSuggestionViews([row({ id: "e2", subject: "   " })], names)[0].subject)
      .toBe("(no subject)");
  });

  it("falls back to Unknown deal when the deal name is not in the map", () => {
    const v = buildEmailSuggestionViews([row({ id: "e1", matched_deal_id: "gone" })], names)[0];
    expect(v.companyName).toBe("Unknown deal");
    expect(v.dealId).toBe("gone");
  });

  it("handles a null matched_deal_id without throwing", () => {
    const v = buildEmailSuggestionViews([row({ id: "e1", matched_deal_id: null })], names)[0];
    expect(v.dealId).toBeNull();
    expect(v.companyName).toBe("Unknown deal");
  });
});
