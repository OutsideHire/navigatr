import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Controllable fake recorder so we can drive state transitions.
const recorder = {
  state: "idle" as "idle" | "recording" | "recorded" | "denied",
  blob: null as Blob | null,
  durationMs: 0,
  mimeType: "audio/webm",
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
};
vi.mock("./useVoiceRecorder", () => ({ useVoiceRecorder: () => recorder }));

const invokeMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

import { useVoiceDictation, appendDictated } from "./useVoiceDictation";

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
  invokeMock.mockReset();
});

describe("appendDictated", () => {
  it("returns the addition when the field is empty", () => {
    expect(appendDictated("", "hello there")).toBe("hello there");
    expect(appendDictated("   ", "hello")).toBe("hello");
  });
  it("joins with a single space, respecting existing trailing whitespace", () => {
    expect(appendDictated("Met with", "Bob")).toBe("Met with Bob");
    expect(appendDictated("Met with ", "Bob")).toBe("Met with Bob");
    expect(appendDictated("Line one\n", "Line two")).toBe("Line one\nLine two");
  });
  it("ignores an empty addition", () => {
    expect(appendDictated("note", "   ")).toBe("note");
  });
});

describe("useVoiceDictation", () => {
  it("starts recording from rest, then stops when recording", () => {
    const { result, rerender } = renderHook(() => useVoiceDictation({ onResult: vi.fn() }));
    expect(result.current.micState).toBe("rest");

    act(() => result.current.toggle());
    expect(recorder.start).toHaveBeenCalledTimes(1);

    recorder.state = "recording";
    rerender();
    expect(result.current.micState).toBe("recording");

    act(() => result.current.toggle());
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("transcribes a finished recording and delivers trimmed text", async () => {
    invokeMock.mockResolvedValue({ data: { text: "  Signed the deal  " }, error: null });
    const onResult = vi.fn();
    const { rerender } = renderHook(() => useVoiceDictation({ onResult }));

    recorder.state = "recorded";
    recorder.blob = fakeBlob();
    rerender();

    await waitFor(() => expect(onResult).toHaveBeenCalledWith("Signed the deal"));
    expect(invokeMock).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({ body: expect.objectContaining({ mime: "audio/webm" }) }),
    );
    expect(recorder.reset).toHaveBeenCalled();
  });

  it("surfaces an error state when transcription fails and delivers no text", async () => {
    invokeMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const onResult = vi.fn();
    const { result, rerender } = renderHook(() => useVoiceDictation({ onResult }));

    recorder.state = "recorded";
    recorder.blob = fakeBlob();
    rerender();

    await waitFor(() => expect(result.current.micState).toBe("error"));
    expect(onResult).not.toHaveBeenCalled();
  });

  it("maps a recorder permission denial to permission-denied", () => {
    const { result, rerender } = renderHook(() => useVoiceDictation({ onResult: vi.fn() }));
    recorder.state = "denied";
    rerender();
    expect(result.current.micState).toBe("permission-denied");
  });
});
