import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { MicState } from "./NotesFieldWithMic";

// Mock the dictation hook so the component test stays presentational. We keep
// the real appendDictated so the append behavior is exercised end-to-end.
let micStateHolder: MicState = "rest";
const toggleMock = vi.fn();
let capturedOnResult: (t: string) => void = () => {};
vi.mock("@/hooks/useVoiceDictation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useVoiceDictation")>();
  return {
    ...actual,
    useVoiceDictation: (opts: { onResult: (t: string) => void }) => {
      capturedOnResult = opts.onResult;
      return { micState: micStateHolder, toggle: toggleMock };
    },
  };
});

import { NotesFieldWithMic } from "./NotesFieldWithMic";

beforeEach(() => {
  micStateHolder = "rest";
  toggleMock.mockReset();
  capturedOnResult = () => {};
});

describe("NotesFieldWithMic", () => {
  it("shows a labeled Dictate button at rest and toggles on tap", () => {
    render(<NotesFieldWithMic value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    expect(toggleMock).toHaveBeenCalledTimes(1);
  });

  it("recording state shows a labeled Stop button that toggles off", () => {
    micStateHolder = "recording";
    render(<NotesFieldWithMic value="" onChange={vi.fn()} />);
    const stop = screen.getByRole("button", { name: /stop/i });
    expect(stop).toBeInTheDocument();
    fireEvent.click(stop);
    expect(toggleMock).toHaveBeenCalledTimes(1);
  });

  it("appends transcribed text into the existing note", () => {
    const onChange = vi.fn();
    render(<NotesFieldWithMic value="Met with" onChange={onChange} />);
    act(() => capturedOnResult("Bob at Acme"));
    expect(onChange).toHaveBeenCalledWith("Met with Bob at Acme");
  });

  it("shows a transcribing status", () => {
    micStateHolder = "transcribing";
    render(<NotesFieldWithMic value="" onChange={vi.fn()} />);
    expect(screen.getByText("Transcribing…")).toBeInTheDocument();
  });

  it("shows a retry-able error message when transcription failed", () => {
    micStateHolder = "error";
    render(<NotesFieldWithMic value="" onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't transcribe/i);
  });

  it("shows the permission-denied helper", () => {
    micStateHolder = "permission-denied";
    render(<NotesFieldWithMic value="" onChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/microphone access denied/i);
  });

  it("manual mode calls the passed handler and ignores self-dictation", () => {
    const onMic = vi.fn();
    // Manual mode paints the passed state (recording → a Stop button) and routes
    // the tap to onMicClick, never the internal toggle.
    render(
      <NotesFieldWithMic value="" onChange={vi.fn()} onMicClick={onMic} micState="recording" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onMic).toHaveBeenCalledTimes(1);
    expect(toggleMock).not.toHaveBeenCalled();
  });
});
