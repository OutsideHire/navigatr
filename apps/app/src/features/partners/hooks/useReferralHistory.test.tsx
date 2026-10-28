import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { referralHistoryKey, useReferralHistory } from "./useReferralHistory";

const limitMock = vi.fn();
const inMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return chain; },
        limit: (...a: unknown[]) => { calls.push(["limit", ...a]); return limitMock(); },
        in: (...a: unknown[]) => { calls.push(["in", ...a]); return inMock(); },
      };
      return chain;
    },
  },
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper };
}

beforeEach(() => {
  limitMock.mockReset();
  inMock.mockReset();
  calls.length = 0;
});

describe("useReferralHistory", () => {
  it("reads the history newest first and names the people who acted", async () => {
    limitMock.mockResolvedValueOnce({
      data: [
        { id: "h-3", from_status: "accepted", to_status: "accepted", actor_type: "user", actor_id: "u-1", note: "Reassigned to Sam Rep", created_at: "2026-10-14T10:00:00Z" },
        { id: "h-2", from_status: "submitted", to_status: "accepted", actor_type: "user", actor_id: "u-1", note: null, created_at: "2026-10-13T10:00:00Z" },
        { id: "h-1", from_status: null, to_status: "submitted", actor_type: "partner", actor_id: null, note: null, created_at: "2026-10-12T10:00:00Z" },
      ],
      error: null,
    });
    inMock.mockResolvedValueOnce({ data: [{ id: "u-1", full_name: "Mia Manager" }], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralHistory("r-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: "h-3", fromStatus: "accepted", toStatus: "accepted", actorType: "user", actorName: "Mia Manager", note: "Reassigned to Sam Rep", createdAt: "2026-10-14T10:00:00Z" },
      { id: "h-2", fromStatus: "submitted", toStatus: "accepted", actorType: "user", actorName: "Mia Manager", note: null, createdAt: "2026-10-13T10:00:00Z" },
      { id: "h-1", fromStatus: null, toStatus: "submitted", actorType: "partner", actorName: null, note: null, createdAt: "2026-10-12T10:00:00Z" },
    ]);
    expect(calls).toEqual([
      ["from", "referral_status_history"],
      ["select", "id, from_status, to_status, actor_type, actor_id, note, created_at"],
      ["eq", "referral_id", "r-1"],
      ["order", "created_at", { ascending: false }],
      ["limit", 100],
      ["from", "profiles"],
      ["select", "id, full_name"],
      ["in", "id", ["u-1"]],
    ]);
  });

  it("skips the name lookup when no person acted", async () => {
    limitMock.mockResolvedValueOnce({
      data: [{ id: "h-1", from_status: null, to_status: "submitted", actor_type: "system", actor_id: null, note: null, created_at: "2026-10-12T10:00:00Z" }],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralHistory("r-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.actorName).toBeNull();
    expect(inMock).not.toHaveBeenCalled();
  });

  it("still shows the history when the names cannot be read", async () => {
    limitMock.mockResolvedValueOnce({
      data: [{ id: "h-1", from_status: null, to_status: "submitted", actor_type: "user", actor_id: "u-1", note: null, created_at: "2026-10-12T10:00:00Z" }],
      error: null,
    });
    inMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralHistory("r-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.actorName).toBeNull();
  });

  it("does not query without a referral", () => {
    const { wrapper } = setup();
    renderHook(() => useReferralHistory(undefined), { wrapper });
    expect(calls).toEqual([]);
  });

  it("reports a read error", async () => {
    limitMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralHistory("r-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("has a stable key", () => {
    expect(referralHistoryKey("r-1")).toEqual(["referrals", "history", "r-1"]);
  });
});
