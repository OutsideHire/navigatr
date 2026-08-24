import { describe, it, expect } from "vitest";
import {
  buildSentDeltaUrl,
  parseDeltaPage,
  processSentMessages,
  type ProcessInput,
} from "./emailPoll";
import type { GraphSentMessage } from "./emailIngest";

describe("buildSentDeltaUrl", () => {
  it("builds the initial Sent Items delta URL with a metadata-only $select", () => {
    const url = buildSentDeltaUrl(null);
    expect(url).toContain("/me/mailFolders/sentitems/messages/delta");
    expect(url).toContain("$select=");
    expect(url).toContain("webLink");
    expect(url).not.toContain("body"); // metadata only
  });
  it("uses the stored deltaLink verbatim for incremental polls", () => {
    expect(buildSentDeltaUrl("https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=xyz"))
      .toBe("https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=xyz");
  });
});

describe("parseDeltaPage", () => {
  it("returns messages + nextLink + deltaLink, dropping tombstones and id-less rows", () => {
    const page = parseDeltaPage({
      value: [
        { id: "m1", subject: "a" },
        { id: "m2", "@removed": { reason: "deleted" } },
        { subject: "no id" } as GraphSentMessage,
      ],
      "@odata.nextLink": "https://next",
    });
    expect(page.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(page.nextLink).toBe("https://next");
    expect(page.deltaLink).toBeNull();
  });
  it("surfaces the deltaLink on the final page", () => {
    const page = parseDeltaPage({ value: [], "@odata.deltaLink": "https://delta" });
    expect(page.deltaLink).toBe("https://delta");
    expect(page.nextLink).toBeNull();
  });
});

function msg(over: Partial<GraphSentMessage> & { id: string }): GraphSentMessage {
  return {
    subject: "s", sentDateTime: "2026-08-06T03:53:59Z", hasAttachments: false,
    webLink: "https://o/" + over.id, conversationId: "conv-" + over.id,
    toRecipients: [{ emailAddress: { address: "jane@acme.com" } }], ...over,
  };
}

function input(messages: GraphSentMessage[], over: Partial<ProcessInput> = {}): ProcessInput {
  return {
    messages,
    orgId: "org1",
    senderUserId: "u1",
    provider: "outlook",
    deals: [{ id: "d1", contactEmail: "jane@acme.com" }],
    internalDomains: ["getnavigatr.io"],
    personalDomains: ["gmail.com"],
    capturedThreadIds: new Set(),
    ...over,
  };
}

describe("processSentMessages", () => {
  it("matched -> a SUGGESTED email_activity row with the match result", () => {
    const out = processSentMessages(input([msg({ id: "m1" })]));
    expect(out.suggestions).toHaveLength(1);
    expect(out.queued).toHaveLength(0);
    expect(out.suggestions[0]).toMatchObject({
      org_id: "org1", sender_user_id: "u1", provider: "outlook", provider_message_id: "m1",
      matched_deal_id: "d1", match_method: "contact_email", match_confidence: 0.99, status: "suggested",
      recipients: ["jane@acme.com"], thread_id: "conv-m1",
    });
  });

  it("unmatched -> queue row", () => {
    const out = processSentMessages(input([msg({ id: "m1", toRecipients: [{ emailAddress: { address: "x@unknown.com" } }] })]));
    expect(out.suggestions).toHaveLength(0);
    expect(out.queued).toHaveLength(1);
    expect(out.queued[0].provider_message_id).toBe("m1");
  });

  it("suppressed (internal-only) -> skipped with reason", () => {
    const out = processSentMessages(input([msg({ id: "m1", toRecipients: [{ emailAddress: { address: "t@getnavigatr.io" } }] })]));
    expect(out.suggestions).toHaveLength(0);
    expect(out.skipped).toEqual([{ providerMessageId: "m1", reason: "internal_only" }]);
  });

  it("thread dedup across a prior poll: second message in a captured thread is skipped", () => {
    const out = processSentMessages(input([msg({ id: "m2", conversationId: "conv-known" })], {
      capturedThreadIds: new Set(["conv-known"]),
    }));
    expect(out.suggestions).toHaveLength(0);
    expect(out.skipped[0].reason).toBe("duplicate");
  });

  it("in-batch thread dedup: two messages in one new thread -> one suggestion, one duplicate", () => {
    const out = processSentMessages(input([
      msg({ id: "m1", conversationId: "conv-same" }),
      msg({ id: "m2", conversationId: "conv-same" }),
    ]));
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].provider_message_id).toBe("m1");
    expect(out.skipped).toEqual([{ providerMessageId: "m2", reason: "duplicate" }]);
  });
});

import { collectSentDelta } from "./emailPoll";

describe("collectSentDelta", () => {
  it("follows nextLink across pages and returns the final deltaLink", async () => {
    const pages = [
      { value: [{ id: "m1" }], "@odata.nextLink": "https://p2" },
      { value: [{ id: "m2" }], "@odata.deltaLink": "https://delta" },
    ];
    let call = 0;
    const fetchImpl = (async () => ({ ok: true, json: async () => pages[call++] })) as unknown as typeof fetch;
    const res = await collectSentDelta("tok", "https://p1", fetchImpl);
    expect(res.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(res.deltaLink).toBe("https://delta");
  });
  it("throws on a non-OK Graph response", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(collectSentDelta("tok", "https://p1", fetchImpl)).rejects.toThrow(/graph sent delta http 401/);
  });
});
