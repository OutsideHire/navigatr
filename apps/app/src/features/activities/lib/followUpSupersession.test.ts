import { describe, it, expect } from "vitest";
import { latestOccurredAtByDeal, isFollowUpSuperseded } from "./followUpSupersession";

const act = (dealId: string, occurredAt: string) => ({ dealId, occurredAt });

describe("latestOccurredAtByDeal", () => {
  it("records the most recent occurredAt per deal", () => {
    const map = latestOccurredAtByDeal([
      act("d-1", "2026-07-01T00:00:00.000Z"),
      act("d-1", "2026-07-05T00:00:00.000Z"),
      act("d-1", "2026-07-03T00:00:00.000Z"),
      act("d-2", "2026-07-02T00:00:00.000Z"),
    ]);
    expect(map.get("d-1")).toBe("2026-07-05T00:00:00.000Z");
    expect(map.get("d-2")).toBe("2026-07-02T00:00:00.000Z");
  });

  it("is empty for no activities", () => {
    expect(latestOccurredAtByDeal([]).size).toBe(0);
  });
});

describe("isFollowUpSuperseded", () => {
  it("supersedes an earlier activity when a later one exists on the deal (the reported bug)", () => {
    const activities = [
      act("d-1", "2026-07-01T00:00:00.000Z"), // old follow-up-setting activity
      act("d-1", "2026-07-10T00:00:00.000Z"), // newer logged outcome
    ];
    const map = latestOccurredAtByDeal(activities);
    // The old activity's overdue follow-up must now be considered handled.
    expect(isFollowUpSuperseded(activities[0], map)).toBe(true);
    // The newer activity is the live one; never superseded.
    expect(isFollowUpSuperseded(activities[1], map)).toBe(false);
  });

  it("does not supersede the only activity on a deal", () => {
    const only = act("d-1", "2026-07-01T00:00:00.000Z");
    const map = latestOccurredAtByDeal([only]);
    expect(isFollowUpSuperseded(only, map)).toBe(false);
  });

  it("does not supersede an activity whose deal is absent from the map", () => {
    const orphan = act("d-9", "2026-07-01T00:00:00.000Z");
    expect(isFollowUpSuperseded(orphan, new Map())).toBe(false);
  });

  it("keeps activities on other deals independent", () => {
    const activities = [
      act("d-1", "2026-07-01T00:00:00.000Z"),
      act("d-1", "2026-07-10T00:00:00.000Z"),
      act("d-2", "2026-07-05T00:00:00.000Z"),
    ];
    const map = latestOccurredAtByDeal(activities);
    // d-2's single activity is not affected by d-1 having a newer touch.
    expect(isFollowUpSuperseded(activities[2], map)).toBe(false);
  });
});
