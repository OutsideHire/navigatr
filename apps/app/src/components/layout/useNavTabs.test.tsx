/**
 * useNavTabs — verifies the Pipeline tab label gets profession-aware
 * relabeling while everything else (icons, routes, order) stays put.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

let capitalizedReturn = "Pipeline";
vi.mock("@/features/profession/useTerm", () => ({
  useTermCapitalized: () => capitalizedReturn,
}));

import { useNavTabs } from "./useNavTabs";
import { MAIN_TABS } from "./nav-tabs";

describe("useNavTabs", () => {
  it("returns 5 tabs in the same order as MAIN_TABS", () => {
    const { result } = renderHook(() => useNavTabs());
    expect(result.current).toHaveLength(MAIN_TABS.length);
    expect(result.current.map((t) => t.key)).toEqual(MAIN_TABS.map((t) => t.key));
  });

  it("overrides only the pipeline tab label", () => {
    capitalizedReturn = "Book";
    const { result } = renderHook(() => useNavTabs());
    const pipeline = result.current.find((t) => t.key === "pipeline");
    expect(pipeline?.label).toBe("Book");
    // Other tabs keep their stock labels.
    expect(result.current.find((t) => t.key === "dashboard")?.label).toBe("Dashboard");
    expect(result.current.find((t) => t.key === "activities")?.label).toBe("Activities");
  });

  it("preserves icons + routes on the pipeline tab when relabeling", () => {
    capitalizedReturn = "Book";
    const { result } = renderHook(() => useNavTabs());
    const pipeline = result.current.find((t) => t.key === "pipeline");
    const stockPipeline = MAIN_TABS.find((t) => t.key === "pipeline");
    expect(pipeline?.to).toBe(stockPipeline?.to);
    expect(pipeline?.icon).toBe(stockPipeline?.icon);
  });

  it("falls back to 'Pipeline' when no profession override is active", () => {
    capitalizedReturn = "Pipeline";
    const { result } = renderHook(() => useNavTabs());
    expect(result.current.find((t) => t.key === "pipeline")?.label).toBe("Pipeline");
  });
});
