import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { REFERRAL_UPDATE_MAX, referralUpdatesKey, usePublishReferralUpdate, useReferralUpdates } from "./useReferralUpdates";

const limitMock = vi.fn();
const rpcMock = vi.fn();
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
      };
      return chain;
    },
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => {
  limitMock.mockReset();
  rpcMock.mockReset();
  calls.length = 0;
});

describe("useReferralUpdates", () => {
  it("reads the referral's updates newest first, with the author's name", async () => {
    limitMock.mockResolvedValueOnce({
      data: [
        { id: "u-2", body: "Demo booked", published_at: "2026-10-13T15:00:00Z", author: { full_name: "Rita Rep" } },
        { id: "u-1", body: "Called", published_at: "2026-10-12T15:00:00Z", author: null },
      ],
      error: null,
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralUpdates("r-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: "u-2", body: "Demo booked", publishedAt: "2026-10-13T15:00:00Z", authorName: "Rita Rep" },
      { id: "u-1", body: "Called", publishedAt: "2026-10-12T15:00:00Z", authorName: null },
    ]);
    expect(calls).toEqual([
      ["from", "referral_updates"],
      ["select", "id, body, published_at, author:profiles(full_name)"],
      ["eq", "referral_id", "r-1"],
      ["order", "published_at", { ascending: false }],
      ["limit", 50],
    ]);
  });

  it("does not query without a referral", () => {
    const { wrapper } = setup();
    renderHook(() => useReferralUpdates(undefined), { wrapper });
    expect(calls).toEqual([]);
  });

  it("reports a read error", async () => {
    limitMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReferralUpdates("r-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("usePublishReferralUpdate", () => {
  it("publishes the trimmed text and refreshes the list", async () => {
    rpcMock.mockResolvedValueOnce({ data: "u-9", error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => usePublishReferralUpdate("r-1"), { wrapper });
    await expect(result.current.mutateAsync("  Demo booked  ")).resolves.toBe("u-9");
    expect(rpcMock).toHaveBeenCalledWith("publish_referral_update", { p_referral_id: "r-1", p_body: "Demo booked" });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: referralUpdatesKey("r-1") }));
  });

  it("maps server errors to plain copy", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => usePublishReferralUpdate("r-1"), { wrapper });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "update_too_long" } });
    await expect(result.current.mutateAsync("x")).rejects.toThrow("Keep the update under 1,000 characters.");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    await expect(result.current.mutateAsync("x")).rejects.toThrow("You don't have access to do that.");
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(result.current.mutateAsync("x")).rejects.toThrow("Couldn't share the update");
  });

  it("caps an update at 1000 characters, like the database", () => {
    expect(REFERRAL_UPDATE_MAX).toBe(1000);
    expect(referralUpdatesKey("r-1")).toEqual(["referrals", "updates", "r-1"]);
  });
});
