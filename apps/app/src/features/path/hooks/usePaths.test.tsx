import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePaths } from "./usePaths";

const orderMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ order: orderMock }) }) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => orderMock.mockReset());

describe("usePaths", () => {
  it("returns the rep's paths with a stop count derived from the joined stops", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        { id: "p1", path_date: "2026-06-03", origin_label: "Current location",
          origin_lat: 30.27, origin_lng: -97.74, status: "planned",
          path_stops: [{ count: 8 }] },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePaths(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: "p1", date: "2026-06-03", originLabel: "Current location",
        originLat: 30.27, originLng: -97.74, status: "planned", stopCount: 8 },
    ]);
  });

  it("surfaces an RLS / query error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    const { result } = renderHook(() => usePaths(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
