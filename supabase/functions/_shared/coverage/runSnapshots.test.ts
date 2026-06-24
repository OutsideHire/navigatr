import { describe, it, expect, vi } from "vitest";
import { runSnapshots, type SnapshotDeps } from "./runSnapshots";
import { DEFAULT_COVERAGE_CONFIG } from "./config";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-24T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

function deps(over: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    listOrgs: vi.fn(async () => [{ id: "org-1", config: DEFAULT_COVERAGE_CONFIG }]),
    listRepIdsWithDials: vi.fn(async () => ["u1"]),
    fetchRepDials: vi.fn(async () => [{ dealId: "d1", detectedAt: ago(6 * HOUR) }]),
    fetchRepCalls: vi.fn(async () => [{ dealId: "d1", occurredAt: ago(5 * HOUR) }]),
    upsertSnapshot: vi.fn(async () => {}),
    log: vi.fn(),
    ...over,
  };
}

describe("runSnapshots", () => {
  it("upserts one snapshot per gradeable rep and reports a summary", async () => {
    const d = deps();
    const summary = await runSnapshots(d, now);
    expect(d.upsertSnapshot).toHaveBeenCalledTimes(1);
    expect((d.upsertSnapshot as any).mock.calls[0][0]).toMatchObject({
      user_id: "u1", snapshot_date: "2026-06-24", call_coverage: 1, call_event_count: 1,
      window_start_date: "2026-05-25", window_end_date: "2026-06-24",
    });
    expect(summary).toEqual({ orgs: 1, reps: 1, snapshots: 1, failures: 0 });
  });

  it("skips a rep with no gradeable dials (no upsert)", async () => {
    const d = deps({ fetchRepDials: vi.fn(async () => [{ dealId: "d1", detectedAt: ago(1 * HOUR) }]) });
    const summary = await runSnapshots(d, now);
    expect(d.upsertSnapshot).not.toHaveBeenCalled();
    expect(summary).toEqual({ orgs: 1, reps: 1, snapshots: 0, failures: 0 });
  });

  it("counts a failing rep without aborting the batch", async () => {
    const d = deps({
      listRepIdsWithDials: vi.fn(async () => ["u1", "u2"]),
      fetchRepDials: vi.fn(async (uid: string) => {
        if (uid === "u1") throw new Error("boom");
        return [{ dealId: "d1", detectedAt: ago(6 * HOUR) }];
      }),
    });
    const summary = await runSnapshots(d, now);
    expect(summary).toEqual({ orgs: 1, reps: 2, snapshots: 1, failures: 1 });
    expect(d.upsertSnapshot).toHaveBeenCalledTimes(1);
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("u1")); // breadcrumb for the swallowed failure
  });

  it("counts an org with no dialing reps and writes nothing", async () => {
    const d = deps({ listRepIdsWithDials: vi.fn(async () => []) });
    const summary = await runSnapshots(d, now);
    expect(summary).toEqual({ orgs: 1, reps: 0, snapshots: 0, failures: 0 });
    expect(d.upsertSnapshot).not.toHaveBeenCalled();
  });
});
