import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceRecorder } from "./useVoiceRecorder";

class FakeRecorder {
  static isTypeSupported = vi.fn(() => true);
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";
  constructor(public stream: unknown, public opts: { mimeType?: string }) {}
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) }); this.onstop?.(); }
}
const stopTrack = vi.fn();
const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder as unknown as typeof MediaRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } } as unknown as Navigator);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("useVoiceRecorder", () => {
  it("starts → recording, stops → recorded with a blob", async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    expect(result.current.state).toBe("idle");
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe("recording");
    act(() => { result.current.stop(); });
    expect(result.current.state).toBe("recorded");
    expect(result.current.blob).toBeInstanceOf(Blob);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("sets denied when getUserMedia rejects", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("no"));
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe("denied");
  });

  it("auto-stops at the 2-minute cap", async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.start(); });
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(result.current.state).toBe("recorded");
  });

  it("reset returns to idle", async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.start(); });
    act(() => { result.current.stop(); });
    act(() => { result.current.reset(); });
    expect(result.current.state).toBe("idle");
    expect(result.current.blob).toBeNull();
  });
});
