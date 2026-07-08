// usePathCalendarSync — verifies the fire-and-forget invoke of the sync_path
// Edge function. Mirrors useFollowupSync / invokeSyncQuietly: a failing invoke
// (returned { error } OR a thrown/rejected promise) must NOT propagate, because
// the path row is already persisted and the calendar block reconciles on the
// next sync pass.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import { usePathCalendarSync } from "./usePathCalendarSync";

beforeEach(() => {
  invoke.mockReset();
});

describe("usePathCalendarSync", () => {
  it("invokes sync_path with { path_id }", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const { result } = renderHook(() => usePathCalendarSync());

    await result.current.syncPath("p1");

    expect(invoke).toHaveBeenCalledWith("sync_path", {
      body: { path_id: "p1" },
    });
  });

  it("resolves (does not throw) when the invoke returns { error }", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "not deployed" } });
    const { result } = renderHook(() => usePathCalendarSync());

    await expect(result.current.syncPath("p1")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("sync_path", {
      body: { path_id: "p1" },
    });
  });

  it("resolves (does not throw) when the invoke itself rejects (network)", async () => {
    invoke.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => usePathCalendarSync());

    await expect(result.current.syncPath("p1")).resolves.toBeUndefined();
  });
});
