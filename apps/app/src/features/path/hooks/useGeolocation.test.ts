import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGeolocation } from "./useGeolocation";

const AUSTIN = { lat: 30.2672, lng: -97.7431 };

function mockGeolocation(impl: Partial<Geolocation>) {
  Object.defineProperty(globalThis.navigator, "geolocation", {
    value: impl,
    configurable: true,
  });
}

describe("useGeolocation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error allow teardown of the stubbed API
    delete (globalThis.navigator as unknown as { geolocation?: unknown }).geolocation;
  });

  it("resolves to ready with the GPS coords on success", async () => {
    mockGeolocation({
      getCurrentPosition: (ok) =>
        ok({ coords: { latitude: 40.0, longitude: -105.0 } } as GeolocationPosition),
    });
    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.coords).toEqual({ lat: 40.0, lng: -105.0 });
  });

  it("returns status 'denied' with null coords when permission is blocked", async () => {
    mockGeolocation({
      getCurrentPosition: (_ok, err) =>
        err?.({ code: 1, message: "denied" } as GeolocationPositionError),
    });
    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(result.current.coords).toBeNull();
  });

  it("returns status 'unavailable' on timeout (code 3)", async () => {
    mockGeolocation({
      getCurrentPosition: (_ok, err) =>
        err?.({ code: 3, message: "timeout" } as GeolocationPositionError),
    });
    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.coords).toBeNull();
  });

  it("returns status 'unavailable' when the API is missing", async () => {
    // no mockGeolocation() → navigator.geolocation is undefined
    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.coords).toBeNull();
  });

  it("never returns the Austin fallback coordinate in any non-ready state", async () => {
    mockGeolocation({
      getCurrentPosition: (_ok, err) =>
        err?.({ code: 1, message: "denied" } as GeolocationPositionError),
    });
    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(result.current.coords).not.toEqual(AUSTIN);
    expect(result.current.coords).toBeNull();
  });

  it("retry re-requests geolocation", async () => {
    const getCurrentPosition = vi.fn((_ok, err) =>
      err?.({ code: 1, message: "denied" } as GeolocationPositionError),
    );
    mockGeolocation({ getCurrentPosition });
    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    act(() => result.current.retry());
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(2));
  });
});
