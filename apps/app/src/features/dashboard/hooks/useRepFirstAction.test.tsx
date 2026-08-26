// Tests deriveRepFirstAction (pure) + the useRepFirstAction React Query
// plumbing: it only queries when enabled + authed, it reports "taken" on a
// first own deal OR own activity, and it FAILS OPEN (a read blip => not-yet
// -acted => the nudge stays visible so a new rep is never left without guidance).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useRepFirstAction, deriveRepFirstAction } from "./useRepFirstAction";

// Head-count mock: from(table).select("id",{count,head}).eq(col,userId) -> {count,error}.
const eqMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: string) => eqMock(table, col, val),
      }),
    }),
  },
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

// Resolve deals/activities counts by table so Promise.all ordering can't flake.
function counts({ deals = 0, activities = 0 }: { deals?: number; activities?: number }) {
  eqMock.mockImplementation((table: string) =>
    Promise.resolve({ count: table === "deals" ? deals : activities, error: null }),
  );
}

beforeEach(() => {
  eqMock.mockReset();
  authUserId = "rep-1";
});

describe("deriveRepFirstAction", () => {
  it("brand-new rep (0/0) has taken nothing", () => {
    expect(deriveRepFirstAction({ ownDealCount: 0, ownActivityCount: 0 })).toEqual({
      hasOwnDeals: false,
      hasOwnActivities: false,
      taken: false,
    });
  });

  it("one own deal counts as taken (boundary at exactly 1)", () => {
    expect(deriveRepFirstAction({ ownDealCount: 0, ownActivityCount: 0 }).taken).toBe(false);
    const one = deriveRepFirstAction({ ownDealCount: 1, ownActivityCount: 0 });
    expect(one.hasOwnDeals).toBe(true);
    expect(one.taken).toBe(true);
  });

  it("one own activity alone counts as taken", () => {
    const a = deriveRepFirstAction({ ownDealCount: 0, ownActivityCount: 1 });
    expect(a.hasOwnActivities).toBe(true);
    expect(a.taken).toBe(true);
  });
});

describe("useRepFirstAction", () => {
  it("does not query when disabled (not a field rep)", async () => {
    const { result } = renderHook(() => useRepFirstAction(false), { wrapper });
    // Disabled: no fetch fires, no loading gate, nothing taken.
    expect(eqMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.taken).toBe(false);
  });

  it("does not query before auth resolves, even when enabled", () => {
    authUserId = undefined;
    const { result } = renderHook(() => useRepFirstAction(true), { wrapper });
    expect(eqMock).not.toHaveBeenCalled();
    expect(result.current.taken).toBe(false);
  });

  it("reports not-taken for a rep with no own deals or activities", async () => {
    counts({ deals: 0, activities: 0 });
    const { result } = renderHook(() => useRepFirstAction(true), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.taken).toBe(false);
    expect(result.current.hasOwnDeals).toBe(false);
    expect(result.current.hasOwnActivities).toBe(false);
  });

  it("reports taken once the rep owns a deal", async () => {
    counts({ deals: 1, activities: 0 });
    const { result } = renderHook(() => useRepFirstAction(true), { wrapper });
    await waitFor(() => expect(result.current.taken).toBe(true));
    expect(result.current.hasOwnDeals).toBe(true);
  });

  it("reports taken once the rep has logged an activity", async () => {
    counts({ deals: 0, activities: 3 });
    const { result } = renderHook(() => useRepFirstAction(true), { wrapper });
    await waitFor(() => expect(result.current.taken).toBe(true));
    expect(result.current.hasOwnActivities).toBe(true);
  });

  it("fails open: a read error keeps the nudge visible (taken=false)", async () => {
    eqMock.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useRepFirstAction(true), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.taken).toBe(false);
  });
});
