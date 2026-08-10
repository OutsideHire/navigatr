// useGeocodeDealCoords — geocodes an existing deal's street address and stamps
// lat/lng so an owed drop-in on that deal becomes routable. Mirrors the
// geocode-and-stamp guard used at deal-create time (useCreateDeal): geocode only
// when the deal has an address, no coordinates, and no place_id.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useGeocodeDealCoords } from "./useGeocodeDealCoords";

// Chainable supabase mock supporting both the read
// (from("deals").select(...).eq(...).single()) and the write
// (from("deals").update(...).eq(...)), plus functions.invoke (the geocoder).
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

beforeEach(() => {
  singleMock.mockReset();
  updateEqMock.mockReset().mockResolvedValue({ error: null });
  updateMock.mockClear();
  invokeMock.mockReset();
});

describe("useGeocodeDealCoords", () => {
  it("geocodes the address and stamps lat/lng when the deal has an address but no coords and no place_id", async () => {
    singleMock.mockResolvedValueOnce({
      data: { address: "123 Main St, Springfield", lat: null, lng: null, place_id: null },
      error: null,
    });
    invokeMock.mockResolvedValueOnce({ data: { result: { lat: 39.8, lng: -89.6 } } });

    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useGeocodeDealCoords(), { wrapper });
    const out = await result.current.mutateAsync({ dealId: "deal-1" });

    expect(invokeMock).toHaveBeenCalledWith("geocode", { body: { query: "123 Main St, Springfield" } });
    expect(updateMock).toHaveBeenCalledWith({ lat: 39.8, lng: -89.6 });
    expect(updateEqMock).toHaveBeenCalledWith("id", "deal-1");
    expect(out).toEqual({ geocoded: true });

    // Re-reads the owed / due-today bands (and the deals list) so the now-located
    // deal migrates out of the "No location yet" group.
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
      expect(keys).toContain(JSON.stringify(["path", "owed-visits"]));
      expect(keys).toContain(JSON.stringify(["path", "due-today-visits"]));
    });
  });

  it("does NOT geocode when the deal already has coordinates", async () => {
    singleMock.mockResolvedValueOnce({
      data: { address: "123 Main St", lat: 12.3, lng: 45.6, place_id: null },
      error: null,
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeocodeDealCoords(), { wrapper });
    const out = await result.current.mutateAsync({ dealId: "deal-2" });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(out).toEqual({ geocoded: false });
  });

  it("does NOT geocode when the deal has a place_id (coords come from its prospect)", async () => {
    singleMock.mockResolvedValueOnce({
      data: { address: "123 Main St", lat: null, lng: null, place_id: "gp-1" },
      error: null,
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeocodeDealCoords(), { wrapper });
    const out = await result.current.mutateAsync({ dealId: "deal-3" });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(out).toEqual({ geocoded: false });
  });

  it("does NOT geocode when the deal has no address", async () => {
    singleMock.mockResolvedValueOnce({
      data: { address: null, lat: null, lng: null, place_id: null },
      error: null,
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeocodeDealCoords(), { wrapper });
    const out = await result.current.mutateAsync({ dealId: "deal-4" });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(out).toEqual({ geocoded: false });
  });

  it("swallows a geocode miss (no result) — deal stays unlocated, no update", async () => {
    singleMock.mockResolvedValueOnce({
      data: { address: "Nowhere", lat: null, lng: null, place_id: null },
      error: null,
    });
    invokeMock.mockResolvedValueOnce({ data: {} });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeocodeDealCoords(), { wrapper });
    const out = await result.current.mutateAsync({ dealId: "deal-5" });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(out).toEqual({ geocoded: false });
  });

  it("swallows a geocoder failure (throws) without rejecting the mutation", async () => {
    singleMock.mockResolvedValueOnce({
      data: { address: "123 Main St", lat: null, lng: null, place_id: null },
      error: null,
    });
    invokeMock.mockRejectedValueOnce(new Error("edge function 500"));

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useGeocodeDealCoords(), { wrapper });
    const out = await result.current.mutateAsync({ dealId: "deal-6" });

    expect(updateMock).not.toHaveBeenCalled();
    expect(out).toEqual({ geocoded: false });
  });
});
