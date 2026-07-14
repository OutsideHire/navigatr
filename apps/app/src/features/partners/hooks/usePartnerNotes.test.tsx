import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { usePartnerNotes, PARTNER_NOTES_QUERY_KEY } from "./usePartnerNotes";

const orderMock = vi.fn();
const eqMock = vi.fn(() => ({ order: orderMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  orderMock.mockReset();
  eqMock.mockClear();
  selectMock.mockClear();
  authUserId = "user-1";
});

describe("usePartnerNotes", () => {
  it("maps rows to PartnerNote, flattening the author join", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "n-1",
          partner_id: "p-1",
          created_by: "user-1",
          body: "Prefers texts",
          created_at: "2026-07-14T12:00:00.000Z",
          author: { full_name: "Sarah Johnson" },
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartnerNotes("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: "n-1",
        partnerId: "p-1",
        createdBy: "user-1",
        body: "Prefers texts",
        createdAt: "2026-07-14T12:00:00.000Z",
        authorName: "Sarah Johnson",
      },
    ]);
  });

  it("normalizes a missing/hidden author to null", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "n-2",
          partner_id: "p-1",
          created_by: "gone",
          body: "x",
          created_at: "2026-07-14T12:00:00.000Z",
          author: null,
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartnerNotes("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].authorName).toBeNull();
  });

  it("is disabled when signed out (no query fires)", () => {
    authUserId = undefined;
    const { result } = renderHook(() => usePartnerNotes("p-1"), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("surfaces Supabase errors via isError", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => usePartnerNotes("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("cache key shape", () => {
    expect(PARTNER_NOTES_QUERY_KEY("u-1", "p-1")).toEqual([
      "partnerNotes", "byPartner", "u-1", "p-1",
    ]);
    expect(PARTNER_NOTES_QUERY_KEY(undefined, "p-1")).toEqual([
      "partnerNotes", "byPartner", "anon", "p-1",
    ]);
  });
});
