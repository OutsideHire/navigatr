import { describe, it, expect } from "vitest";
import { planQueueMigration, type LocalStop } from "./migrateLocalQueue";
import type { Merchant } from "../mockData";

// Merchant has no primaryType field — build a minimal valid Merchant.
const merchant = (over: Partial<Merchant> & { id: string }): Merchant => ({
  id: over.id,
  name: over.name ?? "Biz",
  address: over.address ?? "Addr",
  lat: over.lat ?? 1,
  lng: over.lng ?? 2,
  category: over.category ?? "manufacturing",
  phone: over.phone ?? "+10000000000",
  employeeCountRange: over.employeeCountRange ?? "1-10",
  status: over.status ?? "prospect",
  lastActivity: over.lastActivity ?? null,
} as Merchant);

describe("planQueueMigration", () => {
  it("maps resolvable local stops to snapshots in order", () => {
    const local: LocalStop[] = [{ merchantId: "a" }, { merchantId: "b" }];
    const byId = new Map([
      ["a", merchant({ id: "a", name: "A" })],
      ["b", merchant({ id: "b", name: "B", lat: 3, lng: 4 })],
    ]);
    const { snapshots, unresolved } = planQueueMigration(local, byId);
    expect(unresolved).toEqual([]);
    expect(snapshots).toEqual([
      { prospectId: "a", name: "A", address: "Addr", lat: 1, lng: 2, category: "manufacturing", primaryType: null },
      { prospectId: "b", name: "B", address: "Addr", lat: 3, lng: 4, category: "manufacturing", primaryType: null },
    ]);
  });

  it("skips (and reports) local stops whose merchant details aren't loaded", () => {
    const local: LocalStop[] = [{ merchantId: "a" }, { merchantId: "ghost" }];
    const byId = new Map([["a", merchant({ id: "a" })]]);
    const { snapshots, unresolved } = planQueueMigration(local, byId);
    expect(snapshots.map((s) => s.prospectId)).toEqual(["a"]);
    expect(unresolved).toEqual(["ghost"]);
  });

  it("returns empty for an empty queue", () => {
    expect(planQueueMigration([], new Map())).toEqual({ snapshots: [], unresolved: [] });
  });
});
