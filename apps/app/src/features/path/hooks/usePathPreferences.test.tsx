import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePathPreferences, useUpdateDefaultIndustries } from "./usePathPreferences";
import { RECOMMENDED_SELECTION } from "../lib/industrySelection";

const maybeSingle = vi.fn();
const upsertSingle = vi.fn();
const upsert = vi.fn(() => ({ select: () => ({ single: upsertSingle }) }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ maybeSingle }), upsert }) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

beforeEach(() => { maybeSingle.mockReset(); upsert.mockClear(); upsertSingle.mockReset(); });

describe("usePathPreferences", () => {
  it("returns the saved default industries", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { default_industries: { apparel_accessories: ["clothing_store"] } }, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ apparel_accessories: ["clothing_store"] });
  });
  it("falls back to RECOMMENDED_SELECTION when there is no row", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(RECOMMENDED_SELECTION);
  });
  it("prunes stale (post-migration) keys from the saved selection", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { default_industries: { retail: ["x"], food_beverage: ["y"] } }, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Object.keys(result.current.data ?? {})).toEqual(["food_beverage"]);
  });
  it("falls back to RECOMMENDED_SELECTION when default_industries is empty", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { default_industries: {} }, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(RECOMMENDED_SELECTION);
  });
});

describe("useUpdateDefaultIndustries", () => {
  it("upserts the selection keyed on the user", async () => {
    upsertSingle.mockResolvedValueOnce({ data: { user_id: "user-1" }, error: null });
    const { result } = renderHook(() => useUpdateDefaultIndustries(), { wrapper: wrap(makeClient()) });
    await result.current.mutateAsync({ apparel_accessories: ["clothing_store"] });
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", default_industries: { apparel_accessories: ["clothing_store"] }, updated_at: expect.any(String) },
      { onConflict: "user_id" },
    );
  });
});
