// useFollowupSync — verifies the fire-and-forget invoke of the sync_followup
// Edge function. Mirrors invokeSyncQuietly in useAppointments: a failing invoke
// (returned { error } OR a thrown/rejected promise) must NOT propagate, because
// the deal's next_followup_at is already persisted and calendar state reconciles
// on the next reconcile pass.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import { useFollowupSync } from "./useFollowupSync";

beforeEach(() => {
  invoke.mockReset();
});

describe("useFollowupSync", () => {
  it("invokes sync_followup with { deal_id }", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const { result } = renderHook(() => useFollowupSync());

    await result.current.syncFollowup("d1");

    expect(invoke).toHaveBeenCalledWith("sync_followup", {
      body: { deal_id: "d1" },
    });
  });

  it("resolves (does not throw) when the invoke returns { error }", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "not deployed" } });
    const { result } = renderHook(() => useFollowupSync());

    await expect(result.current.syncFollowup("d1")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("sync_followup", {
      body: { deal_id: "d1" },
    });
  });

  it("resolves (does not throw) when the invoke itself rejects (network)", async () => {
    invoke.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useFollowupSync());

    await expect(result.current.syncFollowup("d1")).resolves.toBeUndefined();
  });
});
