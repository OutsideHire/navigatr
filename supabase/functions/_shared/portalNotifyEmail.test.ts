import { describe, it, expect } from "vitest";
import { renderEmail } from "./emailTemplate";
import {
  INTERNAL_NOTIFY_KINDS,
  KIND_LABEL,
  DIGEST_SENT_LABEL,
  PARTNER_DIGEST_KIND,
  PARTNER_NOTIFY_KINDS,
  PARTNER_SENT_KIND,
  buildPortalNotifyEmail,
  parseDigestPayload,
  parseInternalPayload,
  parsePartnerPayload,
  parseSentPayload,
  type PortalNotifyEmail,
} from "./portalNotifyEmail";

const BASE = "https://app.getnavigatr.io";
const RID = "3f9a21c0-1111-4222-8333-444455556666";
const CTX = { appBaseUrl: BASE, referralId: RID };
const P = {
  slug: "acme",
  orgName: "Acme ISO",
  partnerName: "Jane",
  companyName: "Fresh Bakery",
  ref: "REF-3F9A21C0",
  label: "Received",
  valueCents: null,
  repName: "Rita Rep",
  repEmail: "rita@acme.example",
  updateBody: null,
};
const withLabel = (label: string, extra: Record<string, unknown> = {}) => ({ ...P, label, ...extra });

function copyOf(e: PortalNotifyEmail): string {
  return [e.subject, e.preheader, e.heading, ...e.bodyLines, e.ctaLabel, e.footnote].join("\n");
}

describe("parsePartnerPayload", () => {
  it("accepts the SQL allowlist shape", () => {
    expect(parsePartnerPayload({ ...P, valueCents: 500000 })).toEqual({ ...P, valueCents: 500000, message: null });
  });

  it("accepts the optional decline message key and nothing else extra", () => {
    expect(parsePartnerPayload({ ...P, message: "  Not a fit.  " })?.message).toBe("Not a fit.");
    expect(parsePartnerPayload({ ...P, message: "   " })?.message).toBeNull();
    expect(parsePartnerPayload({ ...P, reason: "outside_icp" })).toBeNull();
    expect(parsePartnerPayload({ ...P, message: "Hi", reason: "outside_icp" })).toBeNull();
  });

  it("rejects a missing field, an internal status, or a non-object", () => {
    expect(parsePartnerPayload({ ...P, companyName: "  " })).toBeNull();
    expect(parsePartnerPayload({ ...P, slug: undefined })).toBeNull();
    expect(parsePartnerPayload({ ...P, label: "working" })).toBeNull();
    expect(parsePartnerPayload({ ...P, label: "lost" })).toBeNull();
    expect(parsePartnerPayload(null)).toBeNull();
    expect(parsePartnerPayload([P])).toBeNull();
  });

  it("drops a value or a rep email that is not well formed", () => {
    expect(parsePartnerPayload({ ...P, valueCents: 12.5 })?.valueCents).toBeNull();
    expect(parsePartnerPayload({ ...P, valueCents: -1 })?.valueCents).toBeNull();
    expect(parsePartnerPayload({ ...P, valueCents: "500000" })?.valueCents).toBeNull();
    expect(parsePartnerPayload({ ...P, repEmail: "not an email" })?.repEmail).toBeNull();
    expect(parsePartnerPayload({ ...P, repEmail: "a@b.co>\r\nBcc: x@y.z" })?.repEmail).toBeNull();
  });
});

describe("strict keys", () => {
  it("rejects a payload carrying a field the SQL never builds", () => {
    expect(parsePartnerPayload({ ...P, internalNote: "secret" })).toBeNull();
    expect(buildPortalNotifyEmail("partner_received", { ...P, status: "working" }, CTX)).toBeNull();
    expect(parseInternalPayload({ appUrlPath: "/partners", companyNames: ["A"], count: 1, extra: 1 })).toBeNull();
  });
});

describe("missing keys and single-line subjects", () => {
  it("drops a payload with a key deleted", () => {
    const { repEmail: _r, ...noRep } = P;
    expect(buildPortalNotifyEmail("partner_received", noRep, CTX)).toBeNull();
    expect(buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: ["A"] }, CTX)).toBeNull();
  });

  it("collapses newlines and tabs in names used in a subject", () => {
    const e = buildPortalNotifyEmail("partner_received", { ...P, companyName: "Fresh\r\nBcc: x\tBakery", orgName: "Acme\nISO" }, CTX)!;
    expect(e.subject).toBe("Fresh Bcc: x Bakery: Received by Acme ISO");
    expect(e.subject).not.toMatch(/[\r\n\t]/);
  });
});

describe("nudge overflow", () => {
  it("uses the true count, not the capped name list", () => {
    const names = Array.from({ length: 20 }, (_, i) => `Biz ${i + 1}`);
    const e = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: names, count: 50 }, CTX)!;
    expect(e.bodyLines[11]).toBe("and 40 more");
    const ten = Array.from({ length: 10 }, (_, i) => `Biz ${i + 1}`);
    const f = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: ten, count: 10 }, CTX)!;
    expect(f.bodyLines).toHaveLength(11);
  });
});

describe("parseInternalPayload", () => {
  it("accepts an app path and company names", () => {
    expect(parseInternalPayload({ appUrlPath: "/partners", companyNames: ["A", " B "], count: 2 })).toEqual({
      appUrlPath: "/partners",
      companyNames: ["A", "B"],
      count: 2,
    });
  });

  it("refuses anything that could leave the app or has no names", () => {
    expect(parseInternalPayload({ appUrlPath: "//evil.example", companyNames: ["A"], count: 1 })).toBeNull();
    expect(parseInternalPayload({ appUrlPath: "https://evil.example", companyNames: ["A"], count: 1 })).toBeNull();
    expect(parseInternalPayload({ appUrlPath: "/partners", companyNames: [], count: 0 })).toBeNull();
    expect(parseInternalPayload({ appUrlPath: "/partners", companyNames: "A", count: 1 })).toBeNull();
  });

  it("never reports fewer than the names it lists", () => {
    expect(parseInternalPayload({ appUrlPath: "/partners", companyNames: ["A", "B"], count: 1 })?.count).toBe(2);
  });
});

describe("partner emails", () => {
  it("received: plain, names the ISO, links to the referral, replies to the rep", () => {
    const e = buildPortalNotifyEmail("partner_received", P, CTX)!;
    expect(e.subject).toBe("Fresh Bakery: Received by Acme ISO");
    expect(e.preheader).toBe("Acme ISO has your referral REF-3F9A21C0.");
    expect(e.heading).toBe("Acme ISO has your referral");
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Thanks for sending Fresh Bakery. Acme ISO has it and will review it soon.",
      "Rita Rep at Acme ISO is your contact. Reply to this email to reach them.",
    ]);
    expect(e.ctaLabel).toBe("View referral");
    expect(e.ctaUrl).toBe(`${BASE}/p/acme/r/${RID}`);
    expect(e.footnote).toBe("You're getting this because you send referrals to Acme ISO. Reference REF-3F9A21C0.");
    expect(e.audience).toBe("partner");
    expect(e.orgName).toBe("Acme ISO");
    expect(e.replyTo).toBe("rita@acme.example");
  });

  it.each([
    ["partner_accepted", "Accepted", "Fresh Bakery: Accepted by Acme ISO", "Good news: Acme ISO is moving forward with Fresh Bakery."],
    ["partner_not_moving_forward", "Not Moving Forward", "Fresh Bakery: Not Moving Forward", "Acme ISO is not moving forward with Fresh Bakery. Thank you for thinking of them."],
    ["partner_closed_won", "Closed Won", "Fresh Bakery: Closed Won", "Great news: Fresh Bakery signed with Acme ISO. Thank you for the referral."],
    ["partner_withdrawn", "Withdrawn", "Fresh Bakery: Withdrawn", "Acme ISO marked Fresh Bakery as Withdrawn and will not follow up on it."],
  ])("%s carries the %s label", (kind, label, subject, line) => {
    const e = buildPortalNotifyEmail(kind, withLabel(label), CTX)!;
    expect(e.subject).toBe(subject);
    expect(e.bodyLines[1]).toBe(line);
    expect(e.ctaUrl).toBe(`${BASE}/p/acme/r/${RID}`);
  });

  it("not moving forward: the rep's message under a note from the ISO", () => {
    const e = buildPortalNotifyEmail(
      "partner_not_moving_forward",
      withLabel("Not Moving Forward", { message: "Thanks Jane.\n\n  They are too small for us right now. <b>hi</b>  " }),
      CTX,
    )!;
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Acme ISO is not moving forward with Fresh Bakery. Thank you for thinking of them.",
      "A note from Acme ISO:",
      "Thanks Jane.",
      "They are too small for us right now. <b>hi</b>",
      "Rita Rep at Acme ISO is your contact. Reply to this email to reach them.",
    ]);
    // The template escapes body lines like any other user text.
    const html = renderEmail({ ...e }).html;
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).not.toContain("<b>hi</b>");
    const plain = buildPortalNotifyEmail("partner_not_moving_forward", withLabel("Not Moving Forward"), CTX)!;
    expect(plain.bodyLines.join(" ")).not.toContain("A note from");
  });

  it("refuses a message on any other kind", () => {
    for (const kind of PARTNER_NOTIFY_KINDS) {
      if (kind === "partner_not_moving_forward") continue;
      const label = kind === "partner_update" ? "Accepted" : KIND_LABEL[kind];
      expect(buildPortalNotifyEmail(kind, withLabel(label, { updateBody: "Hi", message: "Hello" }), CTX)).toBeNull();
    }
  });

  it("refuses a status email whose label does not match its kind", () => {
    for (const kind of Object.keys(KIND_LABEL)) {
      expect(buildPortalNotifyEmail(kind, withLabel("In Progress"), CTX)).toBeNull();
    }
  });

  it("shows the closed value only when the payload carries one", () => {
    const hidden = buildPortalNotifyEmail("partner_closed_won", withLabel("Closed Won"), CTX)!;
    expect(hidden.bodyLines.join(" ")).not.toContain("$");
    const shown = buildPortalNotifyEmail("partner_closed_won", withLabel("Closed Won", { valueCents: 500000 }), CTX)!;
    expect(shown.bodyLines).toContain("Closed value: $5,000.");
  });

  it("update: the rep's words, line by line, then the current label", () => {
    const e = buildPortalNotifyEmail(
      "partner_update",
      withLabel("In Progress", { updateBody: "Spoke with the owner today.\n\n  Demo next Tuesday.  " }),
      CTX,
    )!;
    expect(e.subject).toBe("Fresh Bakery: an update from Acme ISO");
    expect(e.heading).toBe("An update on Fresh Bakery");
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Rita Rep at Acme ISO shared an update:",
      "Spoke with the owner today.",
      "Demo next Tuesday.",
      "Status: In Progress.",
      "Rita Rep at Acme ISO is your contact. Reply to this email to reach them.",
    ]);
    expect(buildPortalNotifyEmail("partner_update", withLabel("In Progress"), CTX)).toBeNull();
  });

  it("without a rep: no Reply-To and a general contact line", () => {
    const e = buildPortalNotifyEmail("partner_received", { ...P, repName: null, repEmail: null }, CTX)!;
    expect(e.replyTo).toBeNull();
    expect(e.bodyLines).toContain("Someone at Acme ISO will be in touch.");
    const nameOnly = buildPortalNotifyEmail("partner_received", { ...P, repEmail: null }, CTX)!;
    expect(nameOnly.replyTo).toBeNull();
    expect(nameOnly.bodyLines).toContain("Rita Rep at Acme ISO is your contact.");
    const update = buildPortalNotifyEmail("partner_update", withLabel("Accepted", { repName: null, updateBody: "Hi" }), CTX)!;
    expect(update.bodyLines[1]).toBe("Acme ISO shared an update:");
  });

  it("links to the portal home when the row has no usable referral id", () => {
    expect(buildPortalNotifyEmail("partner_received", P, { appBaseUrl: BASE, referralId: null })!.ctaUrl).toBe(`${BASE}/p/acme/home`);
    expect(buildPortalNotifyEmail("partner_received", P, { appBaseUrl: BASE, referralId: "../x" })!.ctaUrl).toBe(`${BASE}/p/acme/home`);
  });

  it("never says navigatr in partner copy", () => {
    for (const kind of PARTNER_NOTIFY_KINDS) {
      const label = kind === "partner_update" ? "Accepted" : KIND_LABEL[kind];
      const e = buildPortalNotifyEmail(kind, withLabel(label, { updateBody: "Hello", valueCents: 100 }), CTX)!;
      expect(copyOf(e).toLowerCase()).not.toContain("navigatr");
    }
  });
});

describe("internal emails", () => {
  it("new referral: links to the review queue, no Reply-To", () => {
    const e = buildPortalNotifyEmail("internal_new_referral", { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 }, CTX)!;
    expect(e.subject).toBe("New partner referral: Fresh Bakery");
    expect(e.heading).toBe("New partner referral for you");
    expect(e.bodyLines).toEqual([
      "A partner sent Fresh Bakery through your referral portal.",
      "Review it to accept, merge or decline.",
    ]);
    expect(e.ctaLabel).toBe("Review referral");
    expect(e.ctaUrl).toBe(`${BASE}/partners`);
    expect(e.audience).toBe("internal");
    expect(e.orgName).toBeNull();
    expect(e.replyTo).toBeNull();
  });

  it("nudge: one line per business, singular and plural", () => {
    const one = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 }, CTX)!;
    expect(one.subject).toBe("1 referral still waiting for review");
    expect(one.heading).toBe("1 referral still waiting");
    expect(one.preheader).toBe("Still waiting for review: Fresh Bakery");
    expect(one.bodyLines).toEqual(["These are still waiting for review:", "- Fresh Bakery"]);
    expect(one.footnote).toBe("You get this at the end of your day when referrals are still waiting for review.");
    // The digest can cover up to 7 days, so it never says "today".
    expect([one.preheader, ...one.bodyLines, one.footnote].join(" ")).not.toMatch(/today/i);
    const two = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: ["A Co", "B Co"], count: 2 }, CTX)!;
    expect(two.subject).toBe("2 referrals still waiting for review");
    expect(two.ctaUrl).toBe(`${BASE}/partners`);
  });

  it("new form submission: names the business, links to the review queue", () => {
    const e = buildPortalNotifyEmail(
      "internal_new_submission",
      { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 },
      { appBaseUrl: BASE, referralId: null },
    )!;
    expect(INTERNAL_NOTIFY_KINDS).toContain("internal_new_submission");
    expect(e.subject).toBe("New referral from your form: Fresh Bakery");
    expect(e.preheader).toBe("Fresh Bakery is waiting in Referrals to review.");
    expect(e.heading).toBe("New referral from your referral form");
    expect(e.bodyLines).toEqual([
      "Someone sent Fresh Bakery through your referral form.",
      "Review it to say who sent it, then accept, merge or decline.",
    ]);
    expect(e.ctaLabel).toBe("Review referral");
    expect(e.ctaUrl).toBe(`${BASE}/partners`);
    expect(e.footnote).toBe("You're getting this because referral form submissions are routed to you.");
    expect(e.audience).toBe("internal");
    expect(e.orgName).toBeNull();
    expect(e.replyTo).toBeNull();
  });

  it("new form submission: a name with HTML and line breaks stays one line and renders escaped", () => {
    const e = buildPortalNotifyEmail(
      "internal_new_submission",
      { appUrlPath: "/partners", companyNames: ["<b>Evil</b> Co\r\nBcc: x@y.z\tInc"], count: 1 },
      CTX,
    )!;
    expect(e.subject).toBe("New referral from your form: <b>Evil</b> Co Bcc: x@y.z Inc");
    expect(e.subject).not.toMatch(/[\r\n\t]/);
    expect(e.preheader).not.toMatch(/[\r\n\t]/);
    expect(e.bodyLines[0]).toBe("Someone sent <b>Evil</b> Co Bcc: x@y.z Inc through your referral form.");
    const { html } = renderEmail({ ...e, brand: undefined });
    expect(html).not.toContain("<b>Evil</b>");
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt; Co Bcc: x@y.z Inc");
  });

  it("new form submission: a bad payload is dropped", () => {
    expect(buildPortalNotifyEmail("internal_new_submission", { appUrlPath: "https://evil.example/x", companyNames: ["A"], count: 1 }, CTX)).toBeNull();
    expect(buildPortalNotifyEmail("internal_new_submission", { appUrlPath: "/partners", companyNames: [], count: 1 }, CTX)).toBeNull();
  });

  it("nudge: lists ten and counts the rest", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Biz ${i + 1}`);
    const e = buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners", companyNames: names, count: 12 }, CTX)!;
    expect(e.bodyLines).toHaveLength(12);
    expect(e.bodyLines[10]).toBe("- Biz 10");
    expect(e.bodyLines[11]).toBe("and 2 more");
  });

  it("drops an unknown kind or a bad payload", () => {
    expect(buildPortalNotifyEmail("partner_party", P, CTX)).toBeNull();
    expect(buildPortalNotifyEmail("internal_nudge", { appUrlPath: "/partners" }, CTX)).toBeNull();
    for (const kind of INTERNAL_NOTIFY_KINDS) expect(buildPortalNotifyEmail(kind, P, CTX)).toBeNull();
  });
});

describe("internal_reinstate_available", () => {
  const PATH = "/partners/3f9a21c0-1111-4222-8333-444455556666";

  it("tells the reviewer one declined duplicate can come back, and links to the partner", () => {
    const e = buildPortalNotifyEmail("internal_reinstate_available", { appUrlPath: PATH, companyNames: ["Dup One"], count: 1 }, CTX)!;
    expect(e).not.toBeNull();
    expect(e.audience).toBe("internal");
    expect(e.orgName).toBeNull();
    expect(e.replyTo).toBeNull();
    expect(e.subject).toBe("You can reinstate Dup One");
    expect(e.heading).toBe("A declined duplicate can come back");
    expect(e.bodyLines[0]).toBe(
      "Dup One was declined as a duplicate of an earlier referral. That earlier referral is now closed, so Dup One can be reinstated.",
    );
    expect(e.ctaLabel).toBe("Open partner");
    expect(e.ctaUrl).toBe(`${BASE}${PATH}`);
  });

  it("lists several, at most 10, with a remainder line", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Co ${i + 1}`);
    const e = buildPortalNotifyEmail("internal_reinstate_available", { appUrlPath: PATH, companyNames: names, count: 12 }, CTX)!;
    expect(e.subject).toBe("12 declined duplicates can be reinstated");
    expect(e.heading).toBe("Declined duplicates can come back");
    expect(e.bodyLines).toContain("- Co 10");
    expect(e.bodyLines).not.toContain("- Co 11");
    expect(e.bodyLines).toContain("and 2 more");
  });

  it("counts from the payload count, not from the names it carries", () => {
    const e = buildPortalNotifyEmail("internal_reinstate_available", { appUrlPath: PATH, companyNames: ["Dup One"], count: 5 }, CTX)!;
    expect(e).not.toBeNull();
    expect(e.subject).toBe("5 declined duplicates can be reinstated");
    expect(e.heading).toBe("Declined duplicates can come back");
    expect(e.bodyLines).toContain("- Dup One");
    expect(e.bodyLines).toContain("and 4 more");
  });

  it("is an internal kind, and a malformed payload is dropped", () => {
    expect(INTERNAL_NOTIFY_KINDS).toContain("internal_reinstate_available");
    expect(
      buildPortalNotifyEmail("internal_reinstate_available", { appUrlPath: "https://evil.example/x", companyNames: ["A"], count: 1 }, CTX),
    ).toBeNull();
    expect(buildPortalNotifyEmail("internal_reinstate_available", { appUrlPath: PATH, companyNames: [], count: 1 }, CTX)).toBeNull();
  });
});

const API = "https://proj.supabase.co/functions/v1/portal_api";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const SENT = {
  slug: "acme",
  orgName: "Acme ISO",
  partnerName: "Jane",
  companyName: "Fresh Bakery",
  ref: "REF-3F9A21C0",
  repName: "Rita Rep",
  repEmail: "rita@acme.example",
  note: "Ask for Ann after 3pm.\nShe runs the books.",
};
const DIGEST = {
  slug: "acme",
  orgName: "Acme ISO",
  partnerName: "Jane",
  weekLabel: "Dec 31",
  counts: { submitted: 2, accepted: 1, inProgress: 0, closedWon: 1, notMovingForward: 1, sentToYou: 1 },
  valueCents: 500000,
  items: [
    { companyName: "Gamma Co", label: "Not Moving Forward" },
    { companyName: "Delta Co", label: "Sent to you" },
  ],
  unsubscribeToken: TOKEN,
};

describe("partner_referral_sent", () => {
  it("names the ISO and the business, links to the sent referral, replies to the rep", () => {
    const e = buildPortalNotifyEmail(PARTNER_SENT_KIND, SENT, { ...CTX, portalApiUrl: API })!;
    expect(e.subject).toBe("Acme ISO sent you a referral: Fresh Bakery");
    expect(e.heading).toBe("Acme ISO sent you a referral");
    expect(e.ctaUrl).toBe(`${BASE}/p/acme/s/${RID}`);
    expect(e.replyTo).toBe("rita@acme.example");
    expect(e.audience).toBe("partner");
    expect(e.orgName).toBe("Acme ISO");
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Rita Rep at Acme ISO sent you Fresh Bakery. Open it to see the contact details.",
      "Rita Rep added a note:",
      "Ask for Ann after 3pm.",
      "She runs the books.",
      "Reply to this email to reach Rita Rep.",
    ]);
    expect(e.headers).toBeUndefined();
    expect(e.footerLink).toBeUndefined();
  });

  it("says nothing about a note when there is none, and falls back without a rep", () => {
    const e = buildPortalNotifyEmail(PARTNER_SENT_KIND, { ...SENT, note: null, repName: null, repEmail: null }, CTX)!;
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Acme ISO sent you Fresh Bakery. Open it to see the contact details.",
      "Someone at Acme ISO can tell you more.",
    ]);
    expect(e.replyTo).toBeNull();
  });

  it("offers a reply without naming the rep when only their email is known", () => {
    const e = buildPortalNotifyEmail(PARTNER_SENT_KIND, { ...SENT, note: null, repName: null }, CTX)!;
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Acme ISO sent you Fresh Bakery. Open it to see the contact details.",
      "Reply to this email to reach them.",
    ]);
    expect(e.replyTo).toBe("rita@acme.example");
  });

  it("links to the portal home without a referral id", () => {
    expect(buildPortalNotifyEmail(PARTNER_SENT_KIND, SENT, { appBaseUrl: BASE, referralId: null })!.ctaUrl).toBe(`${BASE}/p/acme/home`);
  });

  it("drops a payload with an extra or missing key", () => {
    expect(parseSentPayload({ ...SENT, status: "accepted" })).toBeNull();
    const { note: _note, ...missing } = SENT;
    expect(parseSentPayload(missing)).toBeNull();
    expect(parseSentPayload({ ...SENT, companyName: " " })).toBeNull();
  });
});

describe("partner_digest", () => {
  const ctx = { ...CTX, referralId: null, portalApiUrl: API };

  it("lists only what happened, with the value and the unsubscribe link and headers", () => {
    const e = buildPortalNotifyEmail(PARTNER_DIGEST_KIND, DIGEST, ctx)!;
    expect(e.subject).toBe("Your weekly referral summary from Acme ISO");
    expect(e.bodyLines).toEqual([
      "Hi Jane,",
      "Here's what happened with your referrals the week of Dec 31.",
      "New referrals you sent: 2",
      "Accepted: 1",
      "Closed Won: 1 ($5,000)",
      "Not Moving Forward: 1",
      "Acme ISO sent you: 1",
      "Recent activity:",
      "- Gamma Co: Not Moving Forward",
      `- Delta Co: ${DIGEST_SENT_LABEL}`,
    ]);
    expect(e.ctaUrl).toBe(`${BASE}/p/acme/home`);
    expect(e.footerLink).toEqual({ label: "Unsubscribe from the weekly summary", url: `${BASE}/p/acme/unsubscribe?t=${TOKEN}` });
    expect(e.headers).toEqual({
      "List-Unsubscribe": `<${API}/unsubscribe_digest?slug=acme&t=${TOKEN}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(e.replyTo).toBeNull();
    expect(e.audience).toBe("partner");
  });

  it("states Closed Won without an amount when the ISO hides values", () => {
    const e = buildPortalNotifyEmail(PARTNER_DIGEST_KIND, { ...DIGEST, valueCents: null }, ctx)!;
    expect(e.bodyLines).toContain("Closed Won: 1");
    expect(renderEmail(e).text).not.toContain("$");
  });

  it("is not built without the portal_api URL, for a quiet week, or for a bad token", () => {
    expect(buildPortalNotifyEmail(PARTNER_DIGEST_KIND, DIGEST, { ...ctx, portalApiUrl: undefined })).toBeNull();
    const zero = { submitted: 0, accepted: 0, inProgress: 0, closedWon: 0, notMovingForward: 0, sentToYou: 0 };
    expect(buildPortalNotifyEmail(PARTNER_DIGEST_KIND, { ...DIGEST, counts: zero, items: [] }, ctx)).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, unsubscribeToken: "short" })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, unsubscribeToken: null })).toBeNull();
  });

  it("drops an item with an internal status, too many items, odd counts, or an extra key", () => {
    expect(parseDigestPayload({ ...DIGEST, items: [{ companyName: "X", label: "won" }] })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, items: Array.from({ length: 11 }, () => ({ companyName: "X", label: "Accepted" })) })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, counts: { ...DIGEST.counts, submitted: -1 } })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, counts: { ...DIGEST.counts, stage: 1 } })).toBeNull();
    expect(parseDigestPayload({ ...DIGEST, status: "won" })).toBeNull();
  });
});

describe("internal_partner_note", () => {
  it("tells the rep a partner wrote back and links to the deal", () => {
    expect(INTERNAL_NOTIFY_KINDS).toContain("internal_partner_note");
    const e = buildPortalNotifyEmail(
      "internal_partner_note",
      { appUrlPath: "/pipeline/3f9a21c0-1111-4222-8333-444455556666", companyNames: ["Fresh Bakery"], count: 1 },
      CTX,
    )!;
    expect(e.subject).toBe("New partner note: Fresh Bakery");
    expect(e.ctaUrl).toBe(`${BASE}/pipeline/3f9a21c0-1111-4222-8333-444455556666`);
    expect(e.audience).toBe("internal");
    expect(e.headers).toBeUndefined();
  });

  it("is worded so it is true for the sender, the deal owner and an administrator", () => {
    const e = buildPortalNotifyEmail(
      "internal_partner_note",
      { appUrlPath: "/pipeline/3f9a21c0-1111-4222-8333-444455556666", companyNames: ["Fresh Bakery"], count: 1 },
      CTX,
    )!;
    expect(e.bodyLines).toEqual(["A partner left a note on Fresh Bakery, a referral your team sent them.", "Open it to read the note."]);
    expect(e.footnote).toBe("You're getting this because a partner wrote back on a referral from your team.");
    expect([...e.bodyLines, e.footnote].join(" ")).not.toMatch(/\byou sent\b/i);
  });
});

describe("internal_assigned", () => {
  it("tells the new owner a referral was assigned to them", () => {
    expect(INTERNAL_NOTIFY_KINDS).toContain("internal_assigned");
    const e = buildPortalNotifyEmail(
      "internal_assigned",
      { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 },
      CTX,
    )!;
    expect(e.subject).toBe("A referral was assigned to you: Fresh Bakery");
    expect(e.ctaUrl).toBe(`${BASE}/partners`);
    expect(e.audience).toBe("internal");
    expect(e.headers).toBeUndefined();
    expect(e.footerLink).toBeUndefined();
    expect(e.bodyLines.join(" ")).toContain("Fresh Bakery");
    // Not the end-of-day digest wording.
    expect(e.subject).not.toMatch(/still waiting/);
  });

  it("keeps a name with HTML and line breaks to one line", () => {
    const e = buildPortalNotifyEmail(
      "internal_assigned",
      { appUrlPath: "/partners", companyNames: ["<b>Evil</b> Co\r\nBcc: x@y.z"], count: 1 },
      CTX,
    )!;
    expect(e.subject).not.toMatch(/[\r\n\t]/);
    expect(renderEmail({ ...e, brand: undefined }).html).not.toContain("<b>Evil</b>");
  });

  it("drops a bad payload", () => {
    expect(buildPortalNotifyEmail("internal_assigned", { appUrlPath: "https://evil.example/x", companyNames: ["A"], count: 1 }, CTX)).toBeNull();
    expect(buildPortalNotifyEmail("internal_assigned", { appUrlPath: "/partners", companyNames: [], count: 1 }, CTX)).toBeNull();
  });
});

describe("only the weekly summary can be unsubscribed from (FR-PORT-84)", () => {
  it("no other kind carries headers or a footer link", () => {
    for (const kind of PARTNER_NOTIFY_KINDS) {
      const label = kind === "partner_update" ? "Accepted" : KIND_LABEL[kind];
      const e = buildPortalNotifyEmail(kind, withLabel(label, { updateBody: "Hi" }), { ...CTX, portalApiUrl: API })!;
      expect(e.headers).toBeUndefined();
      expect(e.footerLink).toBeUndefined();
      expect(renderEmail(e).text).not.toMatch(/unsubscribe/i);
    }
    const sent = buildPortalNotifyEmail(PARTNER_SENT_KIND, SENT, { ...CTX, portalApiUrl: API })!;
    expect(sent.headers).toBeUndefined();
    expect(renderEmail(sent).text).not.toMatch(/unsubscribe/i);
    for (const kind of INTERNAL_NOTIFY_KINDS) {
      const e = buildPortalNotifyEmail(kind, { appUrlPath: "/partners", companyNames: ["A"], count: 1 }, CTX)!;
      expect(e.headers).toBeUndefined();
      expect(e.footerLink).toBeUndefined();
    }
  });
});

describe("portal sign-in address (FR-PORT-23)", () => {
  const ADDR = { url: `${BASE}/p/acme` };
  it("every partner kind carries it, built with portalUrl", () => {
    for (const kind of PARTNER_NOTIFY_KINDS) {
      const label = KIND_LABEL[kind as keyof typeof KIND_LABEL];
      const payload = kind === "partner_update" ? withLabel("Accepted", { updateBody: "Hello" }) : withLabel(label);
      const e = buildPortalNotifyEmail(kind, payload, CTX);
      expect(e).not.toBeNull();
      if (e) expect(e.portalAddress).toEqual(ADDR);
    }
    expect(buildPortalNotifyEmail("partner_received", withLabel(KIND_LABEL.partner_received), CTX)!.portalAddress).toEqual(ADDR);
    expect(buildPortalNotifyEmail(PARTNER_SENT_KIND, SENT, { ...CTX, portalApiUrl: API })!.portalAddress).toEqual(ADDR);
    expect(buildPortalNotifyEmail(PARTNER_DIGEST_KIND, DIGEST, { ...CTX, referralId: null, portalApiUrl: API })!.portalAddress).toEqual(ADDR);
  });
  it("renders the line when branded", () => {
    const e = buildPortalNotifyEmail(PARTNER_SENT_KIND, SENT, { ...CTX, portalApiUrl: API })!;
    const { text } = renderEmail({ ...e, brand: { name: "Acme ISO", logoUrl: null, primaryColor: null } });
    expect(text).toContain(`Sign in to your partner portal any time: ${BASE}/p/acme`);
  });
  it("no internal kind carries it", () => {
    for (const kind of INTERNAL_NOTIFY_KINDS) {
      const e = buildPortalNotifyEmail(kind, { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 }, CTX);
      expect(e).not.toBeNull();
      if (e) {
        expect(e.audience).toBe("internal");
        expect(e.portalAddress).toBeUndefined();
        expect(renderEmail(e).text).not.toContain("partner portal any time");
      }
    }
  });
});
