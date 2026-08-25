import { describe, it, expect } from "vitest";
import { nudgeEmail, opsDigestEmail } from "./noDealsEmail";
import { renderEmail } from "./emailTemplate";

describe("nudgeEmail", () => {
  it("names the org, links into the app, and renders through the branded template", () => {
    const e = nudgeEmail("Acme ISO", "https://app.getnavigatr.io/");
    expect(e.subject).toMatch(/first deal/i);
    expect(e.bodyLines.join(" ")).toContain("Acme ISO");
    // Trailing slash trimmed so the CTA URL is clean.
    expect(e.ctaUrl).toBe("https://app.getnavigatr.io");
    const { html, text } = renderEmail(e);
    expect(html).toContain("Acme ISO");
    expect(text).toContain("Open navigatr");
  });
});

describe("opsDigestEmail", () => {
  it("summarizes multiple dead accounts with a count and per-org lines", () => {
    const e = opsDigestEmail(
      [
        { name: "Acme ISO", ageDays: 5 },
        { name: "Beta Co", ageDays: 1 },
      ],
      "https://app.getnavigatr.io",
    );
    expect(e.subject).toContain("2 accounts");
    const body = e.bodyLines.join("\n");
    expect(body).toContain("Acme ISO");
    expect(body).toContain("Beta Co");
    expect(body).toContain("1 day "); // singular day
    expect(body).toContain("5 days"); // plural days
    const { html } = renderEmail(e);
    expect(html).toContain("Acme ISO");
  });

  it("uses singular phrasing for a single account", () => {
    const e = opsDigestEmail([{ name: "Solo", ageDays: 3 }], "https://app.getnavigatr.io");
    expect(e.subject).toBe("navigatr: 1 account with no deals");
    expect(e.heading).toContain("hasn't");
  });
});
