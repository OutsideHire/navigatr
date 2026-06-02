import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePathOrigin } from "./usePathOrigin";
import type { GeolocationResult } from "./useGeolocation";

// Control the GPS layer.
const geoState = { current: {} as GeolocationResult };
const retryMock = vi.fn();
vi.mock("./useGeolocation", () => ({
  useGeolocation: () => geoState.current,
}));

// Stub the geocode Edge call.
const invokeMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));

beforeEach(() => {
  invokeMock.mockReset();
  retryMock.mockReset();
  geoState.current = { coords: null, status: "loading", error: null, retry: retryMock };
});

describe("usePathOrigin", () => {
  it("uses the GPS fix when ready, labeled 'Current location'", () => {
    geoState.current = {
      coords: { lat: 40, lng: -105 }, status: "ready", error: null, retry: retryMock,
    };
    const { result } = renderHook(() => usePathOrigin());
    expect(result.current.origin).toEqual({ lat: 40, lng: -105 });
    expect(result.current.originSource).toBe("gps");
    expect(result.current.originLabel).toBe("Current location");
  });

  it("returns a null origin when GPS is denied and there is no manual location", () => {
    geoState.current = { coords: null, status: "denied", error: "no", retry: retryMock };
    const { result } = renderHook(() => usePathOrigin());
    expect(result.current.origin).toBeNull();
    expect(result.current.originSource).toBeNull();
    expect(result.current.geoStatus).toBe("denied");
  });

  it("a manual search result wins over the GPS fix", async () => {
    geoState.current = {
      coords: { lat: 40, lng: -105 }, status: "ready", error: null, retry: retryMock,
    };
    invokeMock.mockResolvedValue({
      data: { result: { lat: 30.27, lng: -97.74, label: "Austin, TX, USA" } }, error: null,
    });
    const { result } = renderHook(() => usePathOrigin());
    await act(async () => { await result.current.searchLocation("Austin, TX"); });
    expect(invokeMock).toHaveBeenCalledWith("geocode", { body: { query: "Austin, TX" } });
    expect(result.current.origin).toEqual({ lat: 30.27, lng: -97.74 });
    expect(result.current.originSource).toBe("manual");
    expect(result.current.originLabel).toBe("Austin, TX, USA");
  });

  it("sets searchError and leaves origin unchanged on no match", async () => {
    geoState.current = {
      coords: { lat: 40, lng: -105 }, status: "ready", error: null, retry: retryMock,
    };
    invokeMock.mockResolvedValue({ data: { result: null }, error: null });
    const { result } = renderHook(() => usePathOrigin());
    await act(async () => { await result.current.searchLocation("asdfqwer"); });
    expect(result.current.searchError).toMatch(/no match/i);
    expect(result.current.origin).toEqual({ lat: 40, lng: -105 });
    expect(result.current.originSource).toBe("gps");
  });

  it("useMyLocation clears the manual override and retries GPS", async () => {
    geoState.current = {
      coords: { lat: 40, lng: -105 }, status: "ready", error: null, retry: retryMock,
    };
    invokeMock.mockResolvedValue({
      data: { result: { lat: 30.27, lng: -97.74, label: "Austin, TX, USA" } }, error: null,
    });
    const { result } = renderHook(() => usePathOrigin());
    await act(async () => { await result.current.searchLocation("Austin, TX"); });
    expect(result.current.originSource).toBe("manual");
    act(() => result.current.useMyLocation());
    expect(retryMock).toHaveBeenCalledTimes(1);
    expect(result.current.originSource).toBe("gps");
    expect(result.current.origin).toEqual({ lat: 40, lng: -105 });
  });

  it("ignores a blank query without calling the Edge", async () => {
    const { result } = renderHook(() => usePathOrigin());
    await act(async () => { await result.current.searchLocation("   "); });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
