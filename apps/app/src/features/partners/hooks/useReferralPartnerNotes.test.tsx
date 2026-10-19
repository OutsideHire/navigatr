import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { partnerNoteCountLabel, useDealPartnerNotes, usePartnerNoteCounts } from "./useReferralPartnerNotes";

const endMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return endMock(); },
        limit: (...a: unknown[]) => { calls.push(["limit", ...a]); return endMock(); },
      };
      return chain;
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  endMock.mockReset();
  calls.length = 0;
});

describe("useDealPartnerNotes", () => {
  it("groups the notes of the deal's outbound referrals by partner, newest first, skipping referrals without notes", async () => {
    endMock.mockResolvedValueOnce({
      data: [
        {
          id: "r-1",
          partner_id: "p-1",
          partner: { name: "Jane CPA" },
          notes: [
            { id: "n-1", body: "Called Ann.", created_at: "2026-10-20T12:00:00+00:00" },
            { id: "n-2", body: "Demo booked.", created_at: "2026-10-21T12:00:00+00:00" },
          ],
        },
        { id: "r-2", partner_id: "p-2", partner: null, notes: [] },
      ],
      error: null,
    });
    const { result } = renderHook(() => useDealPartnerNotes("d-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        referralId: "r-1",
        partnerId: "p-1",
        partnerName: "Jane CPA",
        notes: [
          { id: "n-2", body: "Demo booked.", createdAt: "2026-10-21T12:00:00+00:00" },
          { id: "n-1", body: "Called Ann.", createdAt: "2026-10-20T12:00:00+00:00" },
        ],
      },
    ]);
    expect(calls).toEqual([
      ["from", "referrals"],
      ["select", "id, partner_id, partner:partners(name), notes:referral_partner_notes(id, body, created_at)"],
      ["eq", "deal_id", "d-1"],
      ["eq", "direction", "outbound"],
      ["order", "submitted_at", { ascending: true }],
    ]);
  });

  it("does not query without a deal", () => {
    renderHook(() => useDealPartnerNotes(undefined), { wrapper });
    expect(calls).toEqual([]);
  });
});

describe("usePartnerNoteCounts", () => {
  it("counts notes per referred deal", async () => {
    endMock.mockResolvedValueOnce({
      data: [
        { deal_id: "d-1", notes: [{ id: "n-1" }, { id: "n-2" }] },
        { deal_id: "d-2", notes: [] },
        { deal_id: null, notes: [{ id: "n-3" }] },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartnerNoteCounts("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ "d-1": 2 });
    expect(calls).toEqual([
      ["from", "referrals"],
      ["select", "deal_id, notes:referral_partner_notes(id)"],
      ["eq", "partner_id", "p-1"],
      ["eq", "direction", "outbound"],
      ["limit", 500],
    ]);
  });

  it("surfaces a read error", async () => {
    endMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => usePartnerNoteCounts("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("partnerNoteCountLabel", () => {
  it("words the count", () => {
    expect(partnerNoteCountLabel(0)).toBeNull();
    expect(partnerNoteCountLabel(1)).toBe("1 note from partner");
    expect(partnerNoteCountLabel(3)).toBe("3 notes from partner");
  });
});
