import { describe, it, expect } from "vitest";
import { DISPOSITIONS_BY_TYPE, DISPOSITION_VALUES } from "./dispositionSets";
import { DISPOSITIONS } from "@/lib/followUpScheduling";
import type { ActivityType } from "../mockData";

const TYPES: ActivityType[] = ["call", "email", "drop_in", "appointment"];

describe("dispositionSets", () => {
  it("every type has non-empty top/all and top ⊆ all", () => {
    for (const t of TYPES) {
      const set = DISPOSITIONS_BY_TYPE[t];
      expect(set.top.length).toBeGreaterThan(0);
      expect(set.all.length).toBeGreaterThanOrEqual(set.top.length);
      for (const d of set.top) expect(set.all).toContain(d);
    }
  });

  it("differentiates Drop-in from Call (the core contract)", () => {
    const drop = DISPOSITIONS_BY_TYPE.drop_in.all;
    const call = DISPOSITIONS_BY_TYPE.call.all;
    // Drop-in carries field-visit outcomes; Call carries phone outcomes.
    expect(drop).toContain("met_dm");
    expect(drop).not.toContain("connected_with_dm");
    expect(call).toContain("connected_with_dm");
    expect(call).not.toContain("met_dm");
  });

  it("DISPOSITION_VALUES is a superset of every type's options", () => {
    const values = new Set<string>(DISPOSITION_VALUES);
    for (const t of TYPES) {
      for (const d of DISPOSITIONS_BY_TYPE[t].all) expect(values.has(d)).toBe(true);
    }
  });

  it("every value has a spec in DISPOSITIONS", () => {
    for (const v of DISPOSITION_VALUES) expect(DISPOSITIONS[v]).toBeTruthy();
  });
});
