/**
 * navigatr NotesFieldWithMic — Textarea + speech-to-text mic.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 52:24 (rest | recording |
 * permission-denied), extended with transcribing + error states.
 *
 * Behavior: self-managed dictation by default. Tap the mic to record, tap
 * again to stop; the clip is transcribed by the `transcribe` edge function and
 * the text is appended into the note (fully editable afterward). Because every
 * Notes field across the app renders this one component, dictation lights up
 * everywhere at once. The audio is never stored (see useVoiceDictation).
 *
 * Escape hatch: pass `onMicClick` to drive the mic manually (used by the
 * Storybook state gallery). When `onMicClick` is provided, the component paints
 * whatever `micState` you pass and does not record on its own.
 *
 * Wraps the canonical Textarea (Session 7) whose footer hosts the mic button.
 */

import { Mic, MicOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVoiceDictation, appendDictated, type DictationState } from "@/hooks/useVoiceDictation";
import { Textarea } from "./Textarea";

export type MicState = DictationState;

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
  const dictation = useVoiceDictation({
    onResult: (text) => onChange(appendDictated(value, text)),
  });

  // Manual mode paints the passed state; self-managed mode uses the hook.
  const micState: MicState = manual ? (micStateProp ?? "rest") : dictation.micState;
  const handleMic = manual ? onMicClick : dictation.toggle;

  const MicIcon = micState === "permission-denied" ? MicOff : Mic;

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
        onMicClick={handleMic}
        micIcon={MicIcon}
      />

      {/* State overlay over the mic button (Textarea footer, bottom-left). */}
      {micState === "recording" && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-3 left-3 inline-flex h-7 w-7 items-center justify-center rounded-radius-full bg-status-success-bg"
        >
          <span className="absolute inset-0 animate-ping rounded-radius-full bg-status-success/40" />
          <Mic className="relative h-4 w-4 text-status-success" />
        </span>
      )}

      {micState === "transcribing" && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-3 left-3 inline-flex h-7 w-7 items-center justify-center rounded-radius-full bg-surface-sunken"
        >
          <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />
        </span>
      )}

      {micState === "transcribing" && (
        <p className="mt-1 text-caption text-text-muted" role="status">
          Transcribing…
        </p>
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
