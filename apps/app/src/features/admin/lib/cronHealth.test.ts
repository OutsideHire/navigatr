import { describe, it, expect } from "vitest";
import { summarizeCronHealth, cronHealthNeedsAttention, POLL_STALE_MINUTES } from "./cronHealth";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const today = ymd(NOW);
const yesterday = ymd(new Date(NOW.getTime() - 24 * 3600_000));
const twoDaysAgo = ymd(new Date(NOW.getTime() - 2 * 24 * 3600_000));
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("summarizeCronHealth — nightly snapshots", () => {
  it("ok when the latest snapshot is today", () => {
    const [p] = summarizeCronHealth({ persistence: { latest_date: today, rows: 3 } }, NOW);
    expect(p.status).toBe("ok");
  });
  it("ok when the latest is yesterday (today's run hasn't happened yet)", () => {
    const [p] = summarizeCronHealth({ persistence: { latest_date: yesterday, rows: 3 } }, NOW);
    expect(p.status).toBe("ok");
  });
  it("stale when the latest snapshot is 2+ days old", () => {
    const [p] = summarizeCronHealth({ persistence: { latest_date: twoDaysAgo, rows: 3 } }, NOW);
    expect(p.status).toBe("stale");
  });
  it("idle when there are no snapshots yet", () => {
    const [p] = summarizeCronHealth({ persistence: { latest_date: null, rows: 0 } }, NOW);
    expect(p.status).toBe("idle");
    const [p2] = summarizeCronHealth({}, NOW);
    expect(p2.status).toBe("idle");
  });
});

describe("summarizeCronHealth — email capture poll", () => {
  const emailRow = (facts: Parameters<typeof summarizeCronHealth>[0]) =>
    summarizeCronHealth(facts, NOW).find((r) => r.job.startsWith("Email capture"))!;

  it("idle when no mailboxes are connected", () => {
    expect(emailRow({ email_capture: { connections: 0, freshest_poll_at: null, unhealthy: 0 } }).status).toBe("idle");
  });
  it("ok when a connection polled within the window and none are unhealthy", () => {
    expect(emailRow({ email_capture: { connections: 1, freshest_poll_at: minsAgo(3), unhealthy: 0 } }).status).toBe("ok");
  });
  it("stale when the freshest poll is older than the window (poll not running)", () => {
    const r = emailRow({ email_capture: { connections: 1, freshest_poll_at: minsAgo(POLL_STALE_MINUTES + 5), unhealthy: 0 } });
    expect(r.status).toBe("stale");
  });
  it("stale when there is a connection but it has never polled", () => {
    expect(emailRow({ email_capture: { connections: 1, freshest_poll_at: null, unhealthy: 0 } }).status).toBe("stale");
  });
  it("attention when a connection is unhealthy", () => {
    const r = emailRow({ email_capture: { connections: 2, freshest_poll_at: minsAgo(1), unhealthy: 1 } });
    expect(r.status).toBe("attention");
    expect(r.detail).toMatch(/1 of 2/);
  });
});

describe("cronHealthNeedsAttention", () => {
  it("true when any job is stale or attention, false for ok/idle", () => {
    expect(cronHealthNeedsAttention([{ job: "a", status: "ok", detail: "" }, { job: "b", status: "idle", detail: "" }])).toBe(false);
    expect(cronHealthNeedsAttention([{ job: "a", status: "stale", detail: "" }])).toBe(true);
    expect(cronHealthNeedsAttention([{ job: "a", status: "attention", detail: "" }])).toBe(true);
  });
});
