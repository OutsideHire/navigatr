import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VoiceNoteRecorder } from "./VoiceNoteRecorder";

// jsdom lacks createObjectURL — stub it.
beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(globalThis.URL, {
    createObjectURL: vi.fn(() => "blob:fake"),
    revokeObjectURL: vi.fn(),
  }));
});

const base = { durationMs: 0, blob: null as Blob | null, onStart: vi.fn(), onStop: vi.fn(), onReset: vi.fn() };

describe("VoiceNoteRecorder", () => {
  it("idle: shows a record button that calls onStart", () => {
    const onStart = vi.fn();
    render(<VoiceNoteRecorder {...base} state="idle" onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /record|voice note/i }));
    expect(onStart).toHaveBeenCalled();
  });
  it("recording: shows a stop button + timer that calls onStop", () => {
    const onStop = vi.fn();
    render(<VoiceNoteRecorder {...base} state="recording" durationMs={5000} onStop={onStop} />);
    expect(screen.getByText(/0:05/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onStop).toHaveBeenCalled();
  });
  it("recorded: renders an audio player + delete that calls onReset", () => {
    const onReset = vi.fn();
    render(<VoiceNoteRecorder {...base} state="recorded" blob={new Blob(["x"], { type: "audio/webm" })} durationMs={3000} onReset={onReset} />);
    expect(document.querySelector("audio")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /delete|re-record/i }));
    expect(onReset).toHaveBeenCalled();
  });
  it("denied: shows a mic-blocked message", () => {
    render(<VoiceNoteRecorder {...base} state="denied" />);
    expect(screen.getByText(/microphone|blocked|enable/i)).toBeInTheDocument();
  });
});
