import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useActivePath } from "./useActivePath";

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ eq: eqMock }) }) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => { maybeSingleMock.mockReset(); eqMock.mockClear(); });

describe("useActivePath", () => {
  it("returns the day's path with stops ordered by position", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "p1", path_date: "2026-06-03", origin_label: "Current location",
        origin_lat: 30.27, origin_lng: -97.74, status: "planned",
        path_stops: [
          { id: "s2", path_id: "p1", prospect_id: "pr2", name: "B", address: null, lat: 1, lng: 2,
            category: "automotive", primary_type: "car_repair", position: 1, status: "pending",
            disposition: null, deal_created: false, added_at: "t2" },
          { id: "s1", path_id: "p1", prospect_id: "pr1", name: "A", address: null, lat: 3, lng: 4,
            category: "manufacturing_wholesale", primary_type: null, position: 0, status: "pending",
            disposition: null, deal_created: false, added_at: "t1" },
        ],
      },
      error: null,
    });
    const { result } = renderHook(() => useActivePath("2026-06-03"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqMock).toHaveBeenCalledWith("path_date", "2026-06-03");
    expect(result.current.data?.path?.id).toBe("p1");
    expect(result.current.data?.stops.map((s) => s.id)).toEqual(["s1", "s2"]); // sorted by position
  });

  it("returns null path when the day has none", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useActivePath("2026-06-04"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ path: null, stops: [] });
  });

  it("surfaces an RLS / query error", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    const { result } = renderHook(() => useActivePath("2026-06-03"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
