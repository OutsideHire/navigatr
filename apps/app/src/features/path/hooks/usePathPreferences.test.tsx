import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePathPreferences, usePathEndOfDayMinutes, useUpdateDefaultIndustries, useUpdateEndOfDayMinutes, type PathPreferencesRow } from "./usePathPreferences";
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
    maybeSingle.mockResolvedValueOnce({ data: { default_industries: { retail: ["clothing_store"] } }, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ retail: ["clothing_store"] });
  });
  it("falls back to RECOMMENDED_SELECTION when there is no row", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(RECOMMENDED_SELECTION);
  });
  it("folds retired keys into the merged key and drops truly-unknown ones", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { default_industries: { totally_unknown: ["x"], food_beverage: ["restaurant"] } }, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ restaurants_bars_entertainment: ["restaurant"] });
  });
  it("falls back to RECOMMENDED_SELECTION when default_industries is empty", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { default_industries: {} }, error: null });
    const { result } = renderHook(() => usePathPreferences(), { wrapper: wrap(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(RECOMMENDED_SELECTION);
  });
});

describe("PathPreferencesRow type", () => {
  it("includes the nullable per-rep end_of_day_minutes field", () => {
    const row: PathPreferencesRow = {
      user_id: "user-1",
      default_industries: { retail: ["clothing_store"] },
      end_of_day_minutes: null,
      updated_at: "2026-08-11T00:00:00.000Z",
    };
    expect(row.end_of_day_minutes).toBeNull();
    const withOverride: PathPreferencesRow = { ...row, end_of_day_minutes: 18 * 60 };
    expect(withOverride.end_of_day_minutes).toBe(1080);
  });
});

describe("useUpdateDefaultIndustries", () => {
  it("upserts the selection keyed on the user", async () => {
    upsertSingle.mockResolvedValueOnce({ data: { user_id: "user-1" }, error: null });
    const { result } = renderHook(() => useUpdateDefaultIndustries(), { wrapper: wrap(makeClient()) });
    await result.current.mutateAsync({ retail: ["clothing_store"] });
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", default_industries: { retail: ["clothing_store"] }, updated_at: expect.any(String) },
      { onConflict: "user_id" },
    );
  });
});

describe("usePathEndOfDayMinutes", () => {
  it("returns the saved override, and null when unset", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { end_of_day_minutes: 1080 }, error: null });
    const c = makeClient();
    const { result } = renderHook(() => usePathEndOfDayMinutes(), { wrapper: wrap(c) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(1080);
  });
});

describe("useUpdateEndOfDayMinutes", () => {
  it("upserts ONLY the end_of_day_minutes column (never the industries) keyed on the user", async () => {
    upsertSingle.mockResolvedValueOnce({ data: { user_id: "user-1" }, error: null });
    const { result } = renderHook(() => useUpdateEndOfDayMinutes(), { wrapper: wrap(makeClient()) });
    await result.current.mutateAsync(18 * 60);
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "user-1", end_of_day_minutes: 1080, updated_at: expect.any(String) },
      { onConflict: "user_id" },
    );
    // The payload must not carry default_industries, or a save would clobber it.
    expect(upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ default_industries: expect.anything() }),
      expect.anything(),
    );
  });

  it("invalidation refetches the separately-keyed end-of-day read (regression: prefix must cover it)", async () => {
    // Read starts unset (null -> UI shows the default), then the mutation must
    // cause usePathEndOfDayMinutes to refetch and pick up the new value. With a
    // [...KEY, userId] invalidation this prefix-missed and the read stayed stale.
    maybeSingle
      .mockResolvedValueOnce({ data: { end_of_day_minutes: null }, error: null })
      .mockResolvedValue({ data: { end_of_day_minutes: 1080 }, error: null });
    upsertSingle.mockResolvedValue({ data: { user_id: "user-1" }, error: null });
    const c = makeClient();
    const read = renderHook(() => usePathEndOfDayMinutes(), { wrapper: wrap(c) });
    await waitFor(() => expect(read.result.current.isSuccess).toBe(true));
    expect(read.result.current.data).toBeNull();

    const mutation = renderHook(() => useUpdateEndOfDayMinutes(), { wrapper: wrap(c) });
    await mutation.result.current.mutateAsync(18 * 60);

    await waitFor(() => expect(read.result.current.data).toBe(1080));
  });
});
