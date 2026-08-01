/**
 * navigatr NotesFieldWithMic — Textarea + speech-to-text mic.
 *
 * Redesigned dictation UX (2026-07-31 feedback: recording was invisible and
 * stopping was a guess). The field now flips into an obvious "recording mode":
 *   rest          → a labeled "Dictate" pill (not a bare icon)
 *   recording     → red border + pulsing dot + live equalizer + running timer
 *                   + a labeled red "Stop" button (a clearly different target)
 *   transcribing  → spinner + "Transcribing…"
 *   error/denied  → a helper line under the field
 * Plus: a haptic buzz on start/stop (mobile), a one-time hint, an amber timer
 * near the 2-minute cap, and a screen-reader live region.
 *
 * Self-managed by default: it owns the recorder + transcribe call and appends
 * the result into the note. Passing `onMicClick` drives the mic manually and
 * paints the `micState` you pass (used by the Storybook state gallery).
 *
 * Renders its controls in the Textarea footer's left slot (`footerLeft`).
 */

import * as React from "react";
import { Mic, MicOff, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceDictation, appendDictated, type DictationState } from "@/hooks/useVoiceDictation";
import { Textarea } from "./Textarea";

export type MicState = DictationState;

const HINT_KEY = "navigatr:dictation-hint-seen";
const RECORD_AMBER_AT = 105; // amber over the last 15s before the 120s cap

function fmtTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface NotesFieldWithMicProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Manual override: when set, the mic calls this and the component does NOT
   *  self-record. `micState` then drives the visual. Used by stories. */
  onMicClick?: () => void;
  /** Visual state, honored only in manual mode (when `onMicClick` is set). */
  micState?: MicState;
  disabled?: boolean;
  maxLength?: number;
  rows?: number;
  id?: string;
  className?: string;
}

export function NotesFieldWithMic({
  value,
  onChange,
  placeholder = "Add a note about this prospect",
  onMicClick,
  micState: micStateProp,
  disabled = false,
  maxLength,
  rows = 4,
  id,
  className,
}: NotesFieldWithMicProps) {
  const manual = onMicClick !== undefined;
  const [hintSeen, setHintSeen] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(HINT_KEY) === "1";
    } catch {
      return false;
    }
  });

  const markUsed = React.useCallback(() => {
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* private mode / unavailable — non-fatal */
    }
    setHintSeen(true);
  }, []);

  const dictation = useVoiceDictation({
    onResult: (text) => {
      onChange(appendDictated(value, text));
      markUsed();
    },
  });

  const micState: MicState = manual ? micStateProp ?? "rest" : dictation.micState;

  // Running timer while recording (resets when not).
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (micState !== "recording") {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const timerId = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(timerId);
  }, [micState]);

  const activate = React.useCallback(() => {
    if (!manual && typeof navigator !== "undefined") {
      navigator.vibrate?.(20); // quick buzz so a rep feels start/stop without looking
    }
    if (manual) onMicClick?.();
    else dictation.toggle();
  }, [manual, onMicClick, dictation]);

  const showHint = !manual && micState === "rest" && !hintSeen && value.trim() === "";
  const liveMsg =
    micState === "recording" ? "Recording" : micState === "transcribing" ? "Transcribing your note" : "";

  let footerLeft: React.ReactNode;
  if (micState === "recording") {
    const amber = elapsed >= RECORD_AMBER_AT;
    footerLeft = (
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-radius-full bg-status-danger" />
        <span aria-hidden className="flex items-end gap-[2px]" style={{ height: 16 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="dictation-eq-bar rounded-radius-full bg-status-danger"
              style={{ width: 3, height: 16, animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </span>
        <span
          className={cn(
            "text-caption tabular-nums",
            amber ? "text-status-warning" : "text-status-danger",
          )}
        >
          {fmtTime(elapsed)}
        </span>
        <button
          type="button"
          onClick={activate}
          disabled={disabled}
          aria-label="Stop recording"
          className={cn(
            "ml-0.5 inline-flex items-center gap-1.5 rounded-radius-full bg-status-danger px-3 py-1.5",
            "text-caption font-medium text-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger focus-visible:ring-offset-2",
            "disabled:opacity-50",
          )}
        >
          <Square className="h-3 w-3" fill="currentColor" aria-hidden />
          Stop
        </button>
      </div>
    );
  } else if (micState === "transcribing") {
    footerLeft = (
      <span className="inline-flex items-center gap-1.5 text-caption text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Transcribing…
      </span>
    );
  } else {
    const DictateIcon = micState === "permission-denied" ? MicOff : Mic;
    footerLeft = (
      <button
        type="button"
        onClick={activate}
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-radius-full border border-border-default px-3 py-1",
          "text-caption text-text-secondary",
          "hover:bg-surface-sunken hover:text-text-default",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
          "disabled:opacity-50",
        )}
      >
        <DictateIcon className="h-4 w-4" aria-hidden />
        Dictate
      </button>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        rows={rows}
        footerLeft={footerLeft}
        className={micState === "recording" ? "border-status-danger" : undefined}
      />

      <span className="sr-only" role="status" aria-live="polite">
        {liveMsg}
      </span>

      {showHint && (
        <p className="mt-1 text-caption text-text-muted">Tap Dictate, speak, then tap Stop.</p>
      )}

      {micState === "permission-denied" && (
        <p className="mt-1 text-caption text-status-danger" role="alert">
          Microphone access denied. Allow access in your browser settings to dictate notes.
        </p>
      )}

      {micState === "error" && (
        <p className="mt-1 text-caption text-status-danger" role="alert">
          Couldn't transcribe that. Tap the mic to try again, or type your note.
        </p>
      )}
    </div>
  );
}

export default NotesFieldWithMic;
