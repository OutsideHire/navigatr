import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const geolocationMock = vi.fn();
vi.mock("@/features/path/hooks/useGeolocation", () => ({
  useGeolocation: (opts?: { enabled?: boolean }) => geolocationMock(opts),
}));

const activePathMock = vi.fn();
vi.mock("@/features/path/hooks/useActivePath", () => ({
  useActivePath: (date: string) => activePathMock(date),
}));

vi.mock("@/features/path/lib/today", () => ({ todayISO: () => "2026-09-02" }));

import { useDealSearchBias } from "./useDealSearchBias";

beforeEach(() => {
  geolocationMock.mockReset().mockReturnValue({ coords: null });
  activePathMock.mockReset().mockReturnValue({ data: { path: null } });
});

describe("useDealSearchBias", () => {
  it("uses live GPS coords when available (over the path origin)", () => {
    geolocationMock.mockReturnValue({ coords: { lat: 40, lng: -105 } });
    activePathMock.mockReturnValue({ data: { path: { originLat: 1, originLng: 2 } } });
    const { result } = renderHook(() => useDealSearchBias(true));
    expect(result.current).toEqual({ lat: 40, lng: -105 });
  });

  it("falls back to the active path origin when GPS is unavailable", () => {
    geolocationMock.mockReturnValue({ coords: null });
    activePathMock.mockReturnValue({ data: { path: { originLat: 30.2, originLng: -97.7 } } });
    const { result } = renderHook(() => useDealSearchBias(true));
    expect(result.current).toEqual({ lat: 30.2, lng: -97.7 });
  });

  it("returns undefined (unbiased) when neither GPS nor a path origin is available", () => {
    geolocationMock.mockReturnValue({ coords: null });
    activePathMock.mockReturnValue({ data: { path: null } });
    const { result } = renderHook(() => useDealSearchBias(true));
    expect(result.current).toBeUndefined();
  });

  it("ignores a path origin that has a null coordinate", () => {
    geolocationMock.mockReturnValue({ coords: null });
    activePathMock.mockReturnValue({ data: { path: { originLat: 30.2, originLng: null } } });
    const { result } = renderHook(() => useDealSearchBias(true));
    expect(result.current).toBeUndefined();
  });

  it("defers the GPS request and disables the path read when the sheet is closed", () => {
    const { result } = renderHook(() => useDealSearchBias(false));
    expect(result.current).toBeUndefined();
    expect(geolocationMock).toHaveBeenCalledWith({ enabled: false });
    expect(activePathMock).toHaveBeenCalledWith(""); // empty date disables useActivePath
  });

  it("requests GPS and today's active path when the sheet is open", () => {
    renderHook(() => useDealSearchBias(true));
    expect(geolocationMock).toHaveBeenCalledWith({ enabled: true });
    expect(activePathMock).toHaveBeenCalledWith("2026-09-02");
  });
});
