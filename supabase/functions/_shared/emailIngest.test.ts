import { describe, it, expect } from "vitest";
import {
  mapGraphMessage,
  graphRecipientAddresses,
  decideIngest,
  type GraphSentMessage,
  type IngestContext,
} from "./emailIngest";

const graphMsg: GraphSentMessage = {
  id: "AAMk-123",
  internetMessageId: "<abc@acme.com>",
  conversationId: "conv-1",
  subject: "Pricing follow-up",
  sentDateTime: "2026-08-06T03:53:59Z",
  hasAttachments: false,
  webLink: "https://outlook.office365.com/mail/AAMk-123",
  toRecipients: [{ emailAddress: { name: "Jane", address: "Jane@Acme.com" } }],
  ccRecipients: [{ emailAddress: { address: "cc@acme.com" } }],
};

describe("graphRecipientAddresses", () => {
  it("extracts + lowercases valid addresses, drops junk", () => {
    expect(graphRecipientAddresses([
      { emailAddress: { address: "A@B.com" } },
      { emailAddress: { address: "  " } },
      { emailAddress: {} },
      {},
      { emailAddress: { address: "notanemail" } },
    ])).toEqual(["a@b.com"]);
    expect(graphRecipientAddresses(undefined)).toEqual([]);
  });
});

describe("mapGraphMessage", () => {
  it("maps metadata only, normalizes date, merges To+CC lowercased", () => {
    const m = mapGraphMessage(graphMsg, "outlook");
    expect(m).toEqual({
      provider: "outlook",
      providerMessageId: "AAMk-123",
      internetMessageId: "<abc@acme.com>",
      threadId: "conv-1",
      subject: "Pricing follow-up",
      sentAt: "2026-08-06T03:53:59.000Z",
      hasAttachments: false,
      deepLinkUrl: "https://outlook.office365.com/mail/AAMk-123",
      recipients: ["jane@acme.com", "cc@acme.com"],
    });
  });
  it("coalesces missing fields safely", () => {
    const m = mapGraphMessage({ id: "x" }, "outlook");
    expect(m).toEqual({
      provider: "outlook", providerMessageId: "x", internetMessageId: null, threadId: null,
      subject: null, sentAt: null, hasAttachments: false, deepLinkUrl: null, recipients: [],
    });
  });
  it("never carries body/preview (only the mapped fields exist)", () => {
    const withBody = { ...graphMsg, body: { content: "secret" }, bodyPreview: "secret" } as GraphSentMessage;
    const m = mapGraphMessage(withBody, "outlook");
    expect(Object.keys(m).sort()).toEqual(
      ["deepLinkUrl","hasAttachments","internetMessageId","provider","providerMessageId","recipients","sentAt","subject","threadId"],
    );
  });
});

describe("decideIngest", () => {
  const ctx = (over: Partial<IngestContext>): IngestContext => ({
    meta: mapGraphMessage(graphMsg, "outlook"),
    deals: [],
    internalDomains: ["getnavigatr.io"],
    personalDomains: ["gmail.com"],
    threadAlreadyCaptured: false,
    ...over,
  });

  it("matched -> write_activity with deal + confidence + method", () => {
    const d = decideIngest(ctx({ deals: [{ id: "d1", contactEmail: "jane@acme.com" }] }));
    expect(d.action).toBe("write_activity");
    expect(d.dealId).toBe("d1");
    expect(d.method).toBe("contact_email");
    expect(d.confidence).toBe(0.99);
  });

  it("no candidate -> queue with reason", () => {
    const d = decideIngest(ctx({ deals: [{ id: "d1", contactEmail: "someoneelse@other.com" }] }));
    expect(d.action).toBe("queue");
    expect(d.reason).toBe("no_candidate");
  });

  it("already-captured thread -> skip (duplicate)", () => {
    const d = decideIngest(ctx({ threadAlreadyCaptured: true, deals: [{ id: "d1", contactEmail: "jane@acme.com" }] }));
    expect(d.action).toBe("skip");
    expect(d.reason).toBe("duplicate");
  });

  it("internal-only send -> skip (suppressed)", () => {
    const internalMsg = { ...graphMsg, toRecipients: [{ emailAddress: { address: "teammate@getnavigatr.io" } }], ccRecipients: [] };
    const d = decideIngest(ctx({ meta: mapGraphMessage(internalMsg, "outlook") }));
    expect(d.action).toBe("skip");
    expect(d.reason).toBe("internal_only");
  });
});
