import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PORTAL_NOTIFY_BATCH,
  PORTAL_NOTIFY_PACE_MS,
  drainPortalEmails,
  handlePortalNotifyRequest,
  type PortalNotifyDeps,
  type PortalNotifyEnv,
  type PortalNotifyMessage,
} from "./portalNotify";

const ENV: PortalNotifyEnv = {
  appBaseUrl: "https://app.getnavigatr.io",
  fromAddress: "navigatr <invites@send.getnavigatr.io>",
  appEnv: "production",
  emailAllowlist: "",
};
const NOW = new Date("2026-10-14T22:30:00Z");
const RID = "3f9a21c0-1111-4222-8333-444455556666";
const PARTNER_PAYLOAD = {
  slug: "acme",
  orgName: "Acme ISO",
  partnerName: "Jane",
  companyName: "Fresh Bakery",
  ref: "REF-3F9A21C0",
  label: "Accepted",
  valueCents: null,
  repName: "Rita Rep",
  repEmail: "rita@acme.example",
  updateBody: null,
};
const partnerRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  org_id: "o-1",
  kind: "partner_accepted",
  referral_id: RID,
  payload: PARTNER_PAYLOAD,
  recipient: "jane@example.com",
  attempts: 1,
  ...over,
});
const digestRow = (id: string) => ({
  id,
  org_id: "o-1",
  kind: "partner_digest",
  referral_id: null,
  payload: {
    slug: "acme",
    orgName: "Acme ISO",
    partnerName: "Jane",
    weekLabel: "Dec 31",
    counts: { submitted: 1, accepted: 0, inProgress: 0, closedWon: 0, notMovingForward: 0, sentToYou: 0 },
    valueCents: null,
    items: [{ companyName: "Fresh Bakery", label: "Received" }],
    unsubscribeToken: "AbCdEfGhIjKlMnOpQrStUv",
  },
  recipient: "jane@example.com",
  attempts: 1,
});
const INTERNAL_ROW = {
  id: "e-9",
  org_id: "o-1",
  kind: "internal_new_referral",
  referral_id: RID,
  payload: { appUrlPath: "/partners", companyNames: ["Fresh Bakery"], count: 1 },
  recipient: "rita@acme.example",
  attempts: 1,
};

type Rpc = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function setup(rows: unknown[], over: Partial<PortalNotifyDeps> = {}, handlers: Record<string, Rpc> = {}) {
  const marks: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (handlers[name]) return handlers[name](args);
    if (name === "enqueue_portal_nudges") return { data: 2, error: null };
    if (name === "enqueue_portal_digests") return { data: 1, error: null };
    if (name === "claim_portal_emails") return { data: rows, error: null };
    if (name === "mark_portal_email") {
      marks.push(args);
      return { data: null, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  const sendEmail = vi.fn(async (_msg: PortalNotifyMessage) => {});
  const loadBrand = vi.fn(async (_orgId: string) => ({ logoUrl: "https://cdn.example/acme.png", primaryColor: "#0A7C45" }));
  const sleep = vi.fn(async (_ms: number) => {});
  const deps: PortalNotifyDeps = { rpc, sendEmail, loadBrand, sleep, now: () => NOW, env: ENV, ...over };
  return { deps, rpc, sendEmail, loadBrand, sleep, marks };
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("drainPortalEmails", () => {
  it("queues the nudges for now, then claims one batch", async () => {
    const { deps, rpc } = setup([]);
    const summary = await drainPortalEmails(deps);
    expect(rpc.mock.calls[0]).toEqual(["enqueue_portal_nudges", { p_now: "2026-10-14T22:30:00.000Z" }]);
    expect(rpc.mock.calls[1]).toEqual(["enqueue_portal_digests", { p_now: "2026-10-14T22:30:00.000Z" }]);
    expect(rpc.mock.calls[2]).toEqual(["claim_portal_emails", { p_limit: PORTAL_NOTIFY_BATCH }]);
    expect(PORTAL_NOTIFY_PACE_MS).toBe(600);
    expect(PORTAL_NOTIFY_BATCH).toBe(20);
    expect(summary).toEqual({ nudgesQueued: 2, digestsQueued: 1, claimed: 0, sent: 0, dropped: 0, failed: 0 });
  });

  it("sends a partner email in the ISO's name and brand, replying to the rep", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1")]);
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
    expect(msg.to).toBe("jane@example.com");
    expect(msg.replyTo).toBe("rita@acme.example");
    expect(msg.subject).toBe("Fresh Bakery: Accepted by Acme ISO");
    expect(msg.html).toContain('src="https://cdn.example/acme.png"');
    expect(msg.html).toContain("background:#0A7C45;");
    expect(msg.html).toContain("Powered by navigatr");
    expect(msg.text).toContain(`View referral: https://app.getnavigatr.io/p/acme/r/${RID}`);
    expect(marks).toEqual([{ p_id: "e-1", p_outcome: "sent", p_error: null }]);
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
  });

  it("sends an internal email from the shared sender with the default look and no Reply-To", async () => {
    const { deps, sendEmail, loadBrand } = setup([INTERNAL_ROW]);
    await drainPortalEmails(deps);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.from).toBe(ENV.fromAddress);
    expect(msg.to).toBe("rita@acme.example");
    expect("replyTo" in msg).toBe(false);
    expect(msg.html).toContain("background:#5856EB;");
    expect(msg.html).not.toContain("Powered by navigatr");
    expect(loadBrand).not.toHaveBeenCalled();
  });

  it("loads each org's brand once per run", async () => {
    const { deps, loadBrand, sendEmail } = setup([partnerRow("e-1"), partnerRow("e-2")]);
    await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(loadBrand).toHaveBeenCalledTimes(1);
    expect(loadBrand).toHaveBeenCalledWith("o-1");
  });

  it("still sends, name-only, when the brand lookup fails", async () => {
    const { deps, sendEmail } = setup([partnerRow("e-1")], {
      loadBrand: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await drainPortalEmails(deps);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.html).toContain("Acme ISO</span>");
    expect(msg.html).toContain("Powered by navigatr");
  });

  it("drops a row whose payload does not build", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1", { payload: { ...PARTNER_PAYLOAD, label: "lost" } })]);
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(marks).toEqual([{ p_id: "e-1", p_outcome: "dropped", p_error: "invalid_payload" }]);
    expect(summary).toMatchObject({ claimed: 1, dropped: 1 });
  });

  it("drops what the non-production allowlist blocks", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1")], { env: { ...ENV, appEnv: "staging", emailAllowlist: "" } });
    await drainPortalEmails(deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(marks).toEqual([{ p_id: "e-1", p_outcome: "dropped", p_error: "email_guard" }]);
  });

  it("records a failed send and keeps going", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1"), INTERNAL_ROW]);
    sendEmail.mockRejectedValueOnce(new Error("resend 500"));
    const summary = await drainPortalEmails(deps);
    expect(marks).toEqual([
      { p_id: "e-1", p_outcome: "failed", p_error: "resend 500" },
      { p_id: "e-9", p_outcome: "sent", p_error: null },
    ]);
    expect(summary).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
  });

  it("cuts a long provider error to 500 characters", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1")]);
    sendEmail.mockRejectedValueOnce(new Error("x".repeat(800)));
    await drainPortalEmails(deps);
    expect((marks[0].p_error as string).length).toBe(500);
  });

  it("scrubs email addresses from a provider error in the logs and last_error", async () => {
    const { deps, sendEmail, marks } = setup([partnerRow("e-1")]);
    sendEmail.mockRejectedValueOnce(new Error("bad recipient jane@example.com"));
    await drainPortalEmails(deps);
    expect(marks).toEqual([{ p_id: "e-1", p_outcome: "failed", p_error: "bad recipient [email]" }]);
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join("\n");
    expect(logged).toContain("bad recipient [email]");
    expect(logged).not.toContain("jane@example.com");
  });

  it("does not retry a failed mark on a dropped row", async () => {
    let calls = 0;
    const { deps, sendEmail } = setup([partnerRow("e-1", { payload: { ...PARTNER_PAYLOAD, label: "lost" } })], {}, {
      mark_portal_email: () => {
        calls += 1;
        return { data: null, error: { message: "blip" } };
      },
    });
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(calls).toBe(1);
    expect(summary).toMatchObject({ claimed: 1, dropped: 1 });
  });

  it("keeps draining when the nudge step fails", async () => {
    const { deps, sendEmail } = setup([INTERNAL_ROW], {}, {
      enqueue_portal_nudges: () => ({ data: null, error: { message: "lock timeout" } }),
    });
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(summary.nudgesQueued).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("keeps draining when the digest step fails", async () => {
    const { deps, sendEmail } = setup([INTERNAL_ROW], {}, {
      enqueue_portal_digests: () => ({ data: null, error: { message: "lock timeout" } }),
    });
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(summary.digestsQueued).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("sends the weekly summary with the one-click unsubscribe headers and no Reply-To", async () => {
    const api = "https://proj.supabase.co/functions/v1/portal_api";
    const { deps, sendEmail, marks } = setup([digestRow("e-7")], { env: { ...ENV, portalApiUrl: api } });
    await drainPortalEmails(deps);
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.headers).toEqual({
      "List-Unsubscribe": `<${api}/unsubscribe_digest?slug=acme&t=AbCdEfGhIjKlMnOpQrStUv>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect("replyTo" in msg).toBe(false);
    expect(msg.from).toBe('"Acme ISO" <invites@send.getnavigatr.io>');
    expect(msg.text).toContain("Unsubscribe from the weekly summary: https://app.getnavigatr.io/p/acme/unsubscribe?t=AbCdEfGhIjKlMnOpQrStUv");
    expect(marks).toEqual([{ p_id: "e-7", p_outcome: "sent", p_error: null }]);
  });

  it("drops a weekly summary when the portal_api URL is not configured", async () => {
    const { deps, sendEmail, marks } = setup([digestRow("e-8")]);
    await drainPortalEmails(deps);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(marks).toEqual([{ p_id: "e-8", p_outcome: "dropped", p_error: "invalid_payload" }]);
  });

  it("never adds headers to any other email", async () => {
    const { deps, sendEmail } = setup([partnerRow("e-1"), INTERNAL_ROW], { env: { ...ENV, portalApiUrl: "https://x.example/fn" } });
    await drainPortalEmails(deps);
    for (const [msg] of sendEmail.mock.calls) expect("headers" in msg).toBe(false);
  });

  it("throws when the claim fails", async () => {
    const { deps } = setup([], {}, { claim_portal_emails: () => ({ data: null, error: { message: "boom" } }) });
    await expect(drainPortalEmails(deps)).rejects.toThrow("claim failed: boom");
  });

  it("never writes a recipient address to the logs", async () => {
    const guarded = setup([partnerRow("e-1")], { env: { ...ENV, appEnv: "staging", emailAllowlist: "" } });
    await drainPortalEmails(guarded.deps);
    const failing = setup([INTERNAL_ROW]);
    failing.sendEmail.mockRejectedValueOnce(new Error("rejected"));
    await drainPortalEmails(failing.deps);
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join("\n");
    expect(logged).toContain("e-1");
    expect(logged).not.toContain("jane@example.com");
    expect(logged).not.toContain("rita@acme.example");
  });

  it("paces sends: sleeps between consecutive sends, not before the first", async () => {
    const { deps, sleep, sendEmail } = setup([partnerRow("e-1"), partnerRow("e-2"), partnerRow("e-3")]);
    await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 600);
    expect(sleep).toHaveBeenNthCalledWith(2, 600);
  });

  it("does not sleep before a send when earlier rows were not sent", async () => {
    const { deps, sleep } = setup([partnerRow("e-1", { payload: { ...PARTNER_PAYLOAD, label: "lost" } }), partnerRow("e-2")]);
    await drainPortalEmails(deps);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries the sent mark once when it errors, and never re-sends", async () => {
    let calls = 0;
    const { deps, sendEmail, marks } = setup([partnerRow("e-1")], {}, {
      mark_portal_email: (args) => {
        calls += 1;
        marks_push(args);
        return calls === 1 ? { data: null, error: { message: "blip" } } : { data: null, error: null };
      },
    });
    function marks_push(a: Record<string, unknown>) { marks.push(a); }
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(summary).toMatchObject({ sent: 1 });
  });

  it("retries the sent mark once when it throws, then logs without the address", async () => {
    let calls = 0;
    const { deps, sendEmail } = setup([partnerRow("e-1")], {}, {
      mark_portal_email: () => {
        calls += 1;
        throw new Error("network");
      },
    });
    const summary = await drainPortalEmails(deps);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join("\n");
    expect(logged).not.toContain("jane@example.com");
  });
});

describe("handlePortalNotifyRequest", () => {
  const req = (auth?: string) => ({ headers: { get: (n: string) => (n === "Authorization" ? (auth ?? null) : null) } });

  it("answers 401 before any database call when the secret is wrong or missing", async () => {
    const { deps, rpc } = setup([]);
    for (const auth of [undefined, "Bearer nope"]) {
      const res = await handlePortalNotifyRequest(req(auth), "s3cret", deps);
      expect(res.status).toBe(401);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 503 when no cron secret is configured", async () => {
    const { deps, rpc } = setup([]);
    expect((await handlePortalNotifyRequest(req("Bearer x"), undefined, deps)).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 200 with the summary for the right secret", async () => {
    const { deps } = setup([INTERNAL_ROW]);
    const res = await handlePortalNotifyRequest(req("Bearer s3cret"), "s3cret", deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nudgesQueued: 2, digestsQueued: 1, claimed: 1, sent: 1, dropped: 0, failed: 0 });
  });

  it("answers 500 server_error when the claim fails", async () => {
    const { deps } = setup([], {}, { claim_portal_emails: () => ({ data: null, error: { message: "boom" } }) });
    const res = await handlePortalNotifyRequest(req("Bearer s3cret"), "s3cret", deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
});
