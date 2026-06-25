import { describe, it, expect } from "vitest";
import {
  ACTIVITY_TYPE_ICON,
  ACTIVITY_TYPE_ACCENT,
  ACTIVITY_TYPE_LABEL,
} from "./activityTypeMeta";
import type { ActivityType } from "../mockData";

const TYPES: ActivityType[] = ["call", "email", "drop_in", "appointment"];

describe("activityTypeMeta", () => {
  it("has an icon, accent (bg+fg), and label for every activity type", () => {
    for (const t of TYPES) {
      expect(ACTIVITY_TYPE_ICON[t]).toBeTruthy();
      expect(ACTIVITY_TYPE_ACCENT[t].bg).toMatch(/^bg-/);
      expect(ACTIVITY_TYPE_ACCENT[t].fg).toMatch(/^text-/);
      expect(ACTIVITY_TYPE_LABEL[t].length).toBeGreaterThan(0);
    }
  });

  it("labels each type distinctly (no two types share a label)", () => {
    const labels = TYPES.map((t) => ACTIVITY_TYPE_LABEL[t]);
    expect(new Set(labels).size).toBe(TYPES.length);
  });
});
