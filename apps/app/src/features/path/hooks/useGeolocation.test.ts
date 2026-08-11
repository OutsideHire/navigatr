import { describe, it, expect, vi, afterEach } from "vitest";
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
    delete (globalThis.navigator as unknown as { geolocation?: unknown }).geolocation;
    delete (globalThis.navigator as unknown as { permissions?: unknown }).permissions;
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

  it("re-requests geolocation when the permission state changes", async () => {
    const getCurrentPosition = vi.fn((_ok, err) =>
      err?.({ code: 1, message: "denied" } as GeolocationPositionError),
    );
    mockGeolocation({ getCurrentPosition });

    // Fake PermissionStatus that captures the 'change' listener.
    let changeHandler: (() => void) | null = null;
    const permStatus = {
      state: "denied" as PermissionState,
      addEventListener: (evt: string, h: () => void) => { expect(evt).toBe("change"); changeHandler = h; },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(globalThis.navigator, "permissions", {
      value: { query: vi.fn().mockResolvedValue(permStatus) },
      configurable: true,
    });

    const { result } = renderHook(() => useGeolocation());
    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    // Simulate the user re-enabling location → permission 'change' fires.
    await waitFor(() => expect(changeHandler).not.toBeNull());
    await act(async () => { changeHandler!(); });
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(2));
  });

  it("removes the permission change listener on unmount", async () => {
    mockGeolocation({
      getCurrentPosition: (_ok, err) => err?.({ code: 1, message: "denied" } as GeolocationPositionError),
    });
    const removeEventListener = vi.fn();
    let changeHandler: (() => void) | null = null;
    const permStatus = {
      state: "denied" as PermissionState,
      addEventListener: (_evt: string, h: () => void) => { changeHandler = h; },
      removeEventListener,
    };
    Object.defineProperty(globalThis.navigator, "permissions", {
      value: { query: vi.fn().mockResolvedValue(permStatus) },
      configurable: true,
    });
    const { unmount } = renderHook(() => useGeolocation());
    await waitFor(() => expect(changeHandler).not.toBeNull());
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
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

  describe("watch mode (live position for the running map)", () => {
    it("subscribes via watchPosition (not getCurrentPosition) when watch is true, streaming updates", async () => {
      let cb: ((p: GeolocationPosition) => void) | null = null;
      const watchPosition = vi.fn((ok: (p: GeolocationPosition) => void) => {
        cb = ok;
        return 7; // a watch id
      });
      const getCurrentPosition = vi.fn();
      mockGeolocation({ watchPosition, getCurrentPosition, clearWatch: vi.fn() });

      const { result } = renderHook(() => useGeolocation({ watch: true }));
      // Watch mode never calls the one-shot getter.
      expect(watchPosition).toHaveBeenCalledTimes(1);
      expect(getCurrentPosition).not.toHaveBeenCalled();

      // First fix.
      await act(async () => { cb!({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition); });
      await waitFor(() => expect(result.current.coords).toEqual({ lat: 1, lng: 2 }));

      // A later movement update flows through the same subscription.
      await act(async () => { cb!({ coords: { latitude: 3, longitude: 4 } } as GeolocationPosition); });
      await waitFor(() => expect(result.current.coords).toEqual({ lat: 3, lng: 4 }));
    });

    it("clears the active watch on unmount", async () => {
      const clearWatch = vi.fn();
      mockGeolocation({
        watchPosition: vi.fn(() => 42),
        getCurrentPosition: vi.fn(),
        clearWatch,
      });
      const { unmount } = renderHook(() => useGeolocation({ watch: true }));
      unmount();
      expect(clearWatch).toHaveBeenCalledWith(42);
    });

    it("still uses the one-shot getter when watch is false (default)", async () => {
      const watchPosition = vi.fn(() => 1);
      const getCurrentPosition = vi.fn((ok: (p: GeolocationPosition) => void) =>
        ok({ coords: { latitude: 9, longitude: 8 } } as GeolocationPosition),
      );
      mockGeolocation({ watchPosition, getCurrentPosition, clearWatch: vi.fn() });
      const { result } = renderHook(() => useGeolocation());
      await waitFor(() => expect(result.current.coords).toEqual({ lat: 9, lng: 8 }));
      expect(watchPosition).not.toHaveBeenCalled();
    });
  });
});
