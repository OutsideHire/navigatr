import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const recorder = {
  state: "idle" as "idle" | "recording" | "recorded" | "denied",
  blob: null as Blob | null,
  durationMs: 0,
  mimeType: "audio/webm",
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
};
vi.mock("@/hooks/useVoiceRecorder", () => ({ useVoiceRecorder: () => recorder }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const transcribeMock = vi.fn();
vi.mock("../lib/portalApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/portalApi")>();
  return { ...actual, portalApi: { ...actual.portalApi, transcribe: (...a: unknown[]) => transcribeMock(...a) } };
});

import { usePortalDictation } from "./usePortalDictation";
import { PortalApiError } from "../lib/portalApi";

function fakeBlob(): Blob {
  return { arrayBuffer: async () => new TextEncoder().encode("audio").buffer } as unknown as Blob;
}

beforeEach(() => {
  recorder.state = "idle";
  recorder.blob = null;
  recorder.mimeType = "audio/webm";
  recorder.start.mockReset();
  recorder.stop.mockReset();
  recorder.reset.mockReset();
  transcribeMock.mockReset();
});

describe("usePortalDictation", () => {
  it("starts from rest and stops while recording", () => {
    const { result, rerender } = renderHook(() => usePortalDictation({ slug: "acme", token: "tok", onResult: vi.fn() }));
    expect(result.current.micState).toBe("rest");
    act(() => result.current.toggle());
    expect(recorder.start).toHaveBeenCalledTimes(1);
    recorder.state = "recording";
    rerender();
    expect(result.current.micState).toBe("recording");
    act(() => result.current.toggle());
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("sends the clip to the portal with the partner's session and delivers trimmed text", async () => {
    transcribeMock.mockResolvedValue("  Met the owner  ");
    const onResult = vi.fn();
    const { rerender } = renderHook(() => usePortalDictation({ slug: "acme", token: "tok", onResult }));
    recorder.state = "recorded";
    recorder.blob = fakeBlob();
    rerender();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("Met the owner"));
    expect(transcribeMock).toHaveBeenCalledWith("acme", "tok", btoa("audio"), "audio/webm");
    expect(recorder.reset).toHaveBeenCalled();
  });

  it("shows an error when transcription fails, and permission-denied when the mic is refused", async () => {
    transcribeMock.mockRejectedValue(new Error("rate_limited"));
    const { result, rerender } = renderHook(() => usePortalDictation({ slug: "acme", token: "tok", onResult: vi.fn() }));
    recorder.state = "recorded";
    recorder.blob = fakeBlob();
    rerender();
    await waitFor(() => expect(result.current.micState).toBe("error"));

    recorder.state = "denied";
    recorder.blob = null;
    const denied = renderHook(() => usePortalDictation({ slug: "acme", token: "tok", onResult: vi.fn() }));
    expect(denied.result.current.micState).toBe("permission-denied");
  });

  it("hands a 401 from transcribe to onUnauthorized so the layout can expire the session", async () => {
    transcribeMock.mockRejectedValue(new PortalApiError(401, "unauthorized"));
    const onUnauthorized = vi.fn();
    const { result, rerender } = renderHook(() =>
      usePortalDictation({ slug: "acme", token: "tok", onResult: vi.fn(), onUnauthorized }),
    );
    recorder.state = "recorded";
    recorder.blob = fakeBlob();
    rerender();
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    expect(result.current.tooLong).toBe(false);
  });

  it("flags a 413 as too long, and other failures are not", async () => {
    transcribeMock.mockRejectedValue(new PortalApiError(413, "audio_too_large"));
    const onUnauthorized = vi.fn();
    const { result, rerender } = renderHook(() =>
      usePortalDictation({ slug: "acme", token: "tok", onResult: vi.fn(), onUnauthorized }),
    );
    recorder.state = "recorded";
    recorder.blob = fakeBlob();
    rerender();
    await waitFor(() => expect(result.current.micState).toBe("error"));
    expect(result.current.tooLong).toBe(true);
    expect(onUnauthorized).not.toHaveBeenCalled();

    // Starting a new recording clears the flag.
    recorder.state = "idle";
    rerender();
    act(() => result.current.toggle());
    expect(result.current.tooLong).toBe(false);
  });
});
