import { describe, it, expect } from "vitest";
import {
  summarizeEmailConnectionHealth,
  STALE_POLL_HOURS,
  type EmailConnectionHealthRow,
} from "./emailConnectionHealth";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function row(over: Partial<EmailConnectionHealthRow> & { user_id: string }): EmailConnectionHealthRow {
  return {
    rep_name: "Rep " + over.user_id,
    provider: "outlook",
    health: "ok",
    last_poll_at: hoursAgo(1),
    capture_start_date: hoursAgo(100),
    last_error: null,
    ...over,
  };
}

describe("summarizeEmailConnectionHealth", () => {
  it("counts a recently-polled ok connection as healthy / Connected", () => {
    const s = summarizeEmailConnectionHealth([row({ user_id: "u1" })], NOW);
    expect(s).toMatchObject({ total: 1, healthy: 1, attention: 0 });
    expect(s.rows[0]).toMatchObject({ healthy: true, stale: false, statusLabel: "Connected" });
  });

  it("flags a non-ok health as attention with a reconnect/error label", () => {
    const s = summarizeEmailConnectionHealth(
      [row({ user_id: "u1", health: "needs_reauth" }), row({ user_id: "u2", health: "error" })],
      NOW,
    );
    expect(s).toMatchObject({ total: 2, healthy: 0, attention: 2 });
    expect(s.rows[0].statusLabel).toBe("Needs reconnect");
    expect(s.rows[1].statusLabel).toBe("Error");
  });

  it("treats an ok connection with no recent poll as stale / Idle (attention)", () => {
    const s = summarizeEmailConnectionHealth(
      [row({ user_id: "u1", health: "ok", last_poll_at: hoursAgo(STALE_POLL_HOURS + 1) })],
      NOW,
    );
    expect(s).toMatchObject({ total: 1, healthy: 0, attention: 1 });
    expect(s.rows[0]).toMatchObject({ stale: true, healthy: false, statusLabel: "Idle" });
  });

  it("treats a never-polled connection as stale", () => {
    const s = summarizeEmailConnectionHealth([row({ user_id: "u1", last_poll_at: null })], NOW);
    expect(s.rows[0].stale).toBe(true);
    expect(s.rows[0].statusLabel).toBe("Idle");
  });

  it("summarizes a mixed fleet", () => {
    const s = summarizeEmailConnectionHealth(
      [
        row({ user_id: "u1" }), // healthy
        row({ user_id: "u2", health: "needs_reauth" }), // attention
        row({ user_id: "u3", last_poll_at: hoursAgo(48) }), // stale -> attention
      ],
      NOW,
    );
    expect(s).toMatchObject({ total: 3, healthy: 1, attention: 2 });
  });

  it("handles an empty fleet", () => {
    expect(summarizeEmailConnectionHealth([], NOW)).toEqual({
      total: 0,
      healthy: 0,
      attention: 0,
      rows: [],
    });
  });
});
