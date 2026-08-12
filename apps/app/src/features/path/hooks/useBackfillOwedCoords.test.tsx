// useBackfillOwedCoords — lazily geocode the no-location owed drop-in stubs that
// HAVE a street address so they migrate into the routed path. One attempt per
// dealId per session (deduped), best-effort. Drives the real
// useGeocodeDealCoords against a mocked supabase so we can assert the geocode +
// persist + band invalidation actually fire.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useBackfillOwedCoords } from "./useBackfillOwedCoords";
import type { OwedVisitNoCoords } from "../lib/owedVisits";

const singleMock = vi.fn();
const updateEqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: updateEqMock }));
const invokeMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: singleMock }) }),
      update: updateMock,
    }),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

const stub = (over: Partial<OwedVisitNoCoords> & { dealId: string }): OwedVisitNoCoords => ({
  taskId: `task-${over.dealId}`,
  name: "Acme",
  address: "123 Main St",
  ...over,
});

beforeEach(() => {
  singleMock.mockReset();
  updateEqMock.mockReset().mockResolvedValue({ error: null });
  updateMock.mockClear();
  invokeMock.mockReset();
});

describe("useBackfillOwedCoords", () => {
  it("geocodes an addressed no-coords stub once, persists lat/lng, and invalidates the owed/due-today bands", async () => {
    singleMock.mockResolvedValue({
      data: { address: "123 Main St", lat: null, lng: null, place_id: null },
      error: null,
    });
    invokeMock.mockResolvedValue({ data: { result: { lat: 10, lng: 20 } } });

    const { wrapper, invalidateSpy } = makeWrapper();
    renderHook(() => useBackfillOwedCoords([stub({ dealId: "d-1" })]), { wrapper });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(invokeMock).toHaveBeenCalledWith("geocode", { body: { query: "123 Main St" } });
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ lat: 10, lng: 20 }));
    expect(updateEqMock).toHaveBeenCalledWith("id", "d-1");

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
      expect(keys).toContain(JSON.stringify(["path", "owed-visits"]));
      expect(keys).toContain(JSON.stringify(["path", "due-today-visits"]));
    });
  });

  it("skips a stub with no address (never geocodes)", async () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useBackfillOwedCoords([stub({ dealId: "d-2", address: null })]), { wrapper });

    // Give any effect a tick to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(invokeMock).not.toHaveBeenCalled();
    expect(singleMock).not.toHaveBeenCalled();
  });

  it("does not re-geocode the same dealId twice across re-renders", async () => {
    singleMock.mockResolvedValue({
      data: { address: "123 Main St", lat: null, lng: null, place_id: null },
      error: null,
    });
    invokeMock.mockResolvedValue({ data: { result: { lat: 10, lng: 20 } } });

    const { wrapper } = makeWrapper();
    const stubs = [stub({ dealId: "d-3" })];
    const { rerender } = renderHook(({ s }) => useBackfillOwedCoords(s), {
      wrapper,
      initialProps: { s: stubs },
    });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    // A fresh array identity carrying the SAME dealId must not re-fire.
    rerender({ s: [stub({ dealId: "d-3" })] });
    await new Promise((r) => setTimeout(r, 10));
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("attempts each distinct dealId exactly once", async () => {
    singleMock.mockResolvedValue({
      data: { address: "123 Main St", lat: null, lng: null, place_id: null },
      error: null,
    });
    invokeMock.mockResolvedValue({ data: { result: { lat: 10, lng: 20 } } });

    const { wrapper } = makeWrapper();
    renderHook(
      () => useBackfillOwedCoords([stub({ dealId: "d-4" }), stub({ dealId: "d-5" })]),
      { wrapper },
    );

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
  });
});
