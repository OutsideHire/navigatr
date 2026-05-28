/**
 * useTerm / useFieldVisible — verify they consume useOrgProfession's data
 * correctly and pick the right fallback during loading.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTerm, useFieldVisible } from "./useTerm";
import type { OrgProfessionShape } from "./useOrgProfession";

let queryReturn: { data?: OrgProfessionShape } = {};
vi.mock("./useOrgProfession", () => ({
  useOrgProfession: () => queryReturn,
}));

describe("useTerm", () => {
  it("returns the resolved term when data is loaded", () => {
    queryReturn = {
      data: {
        profession: "merchant_services",
        terminology: {},
        hiddenFields: [],
        pipelineStages: [],
      },
    };
    const { result } = renderHook(() => useTerm("company"));
    expect(result.current).toBe("merchant");
  });

  it("prefers org override over profession default", () => {
    queryReturn = {
      data: {
        profession: "merchant_services",
        terminology: { company: "submerchant" },
        hiddenFields: [],
        pipelineStages: [],
      },
    };
    const { result } = renderHook(() => useTerm("company"));
    expect(result.current).toBe("submerchant");
  });

  it("returns TERM_FALLBACKS string while query is loading", () => {
    queryReturn = {};
    const { result } = renderHook(() => useTerm("deal"));
    expect(result.current).toBe("deal");
  });

  it("falls back when profession is null", () => {
    queryReturn = {
      data: {
        profession: null,
        terminology: {},
        hiddenFields: [],
        pipelineStages: [],
      },
    };
    const { result } = renderHook(() => useTerm("value"));
    expect(result.current).toBe("value");
  });
});

describe("useFieldVisible", () => {
  it("returns true for fields not in hidden_fields", () => {
    queryReturn = {
      data: {
        profession: "merchant_services",
        terminology: {},
        hiddenFields: ["annual_volume"],
        pipelineStages: [],
      },
    };
    const { result } = renderHook(() => useFieldVisible("contact_name"));
    expect(result.current).toBe(true);
  });

  it("returns false for fields in hidden_fields", () => {
    queryReturn = {
      data: {
        profession: "merchant_services",
        terminology: {},
        hiddenFields: ["annual_volume"],
        pipelineStages: [],
      },
    };
    const { result } = renderHook(() => useFieldVisible("annual_volume"));
    expect(result.current).toBe(false);
  });

  it("defaults to true while loading (legacy components keep rendering)", () => {
    queryReturn = {};
    const { result } = renderHook(() => useFieldVisible("annual_volume"));
    expect(result.current).toBe(true);
  });
});
