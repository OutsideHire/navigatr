/**
 * navigatr NotesFieldWithMic — Textarea + speech-to-text mic affordance.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 52:24 (3 variants: State =
 * rest | recording | permission-denied).
 *
 *   rest                Textarea + Mic icon (outlined) bottom-right
 *   recording           Mic icon filled status/success + pulse animation
 *   permission-denied   Mic icon outlined status/danger + helper line
 *
 * This is the UI affordance only — Web Speech API wiring happens in a
 * later session. The parent owns the recording state; this component just
 * paints whichever state was passed.
 *
 * Wraps the canonical Textarea (Session 7) and positions a mic button
 * inside the Textarea's footer slot (Textarea already supports
 * `onMicClick` natively — we add the visual state machine on top).
 */

import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "./Textarea";

export type MicState = "rest" | "recording" | "permission-denied";

export interface NotesFieldWithMicProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onMicClick?: () => void;
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
  micState = "rest",
  disabled = false,
  maxLength,
  rows = 4,
  id,
  className,
}: NotesFieldWithMicProps) {
  const MicIcon = micState === "permission-denied" ? MicOff : Mic;

  // Build a custom mic icon style based on state by wrapping micIcon prop
  // (Textarea renders the icon at h-4 w-4 inside a 7×7 round button). We
  // can't tint the button background from Textarea props alone, so we
  // ship the visual state via a thin overlay positioned over the mic
  // button. Simple + works.

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
        onMicClick={onMicClick}
        micIcon={MicIcon}
      />

      {/* State overlay — only when active. Positioned over the mic button
          in Textarea's footer (bottom-left of the bottom toolbar). */}
      {micState === "recording" && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-3 left-3 inline-flex h-7 w-7 items-center justify-center rounded-radius-full bg-status-success-bg"
        >
          <span className="absolute inset-0 animate-ping rounded-radius-full bg-status-success/40" />
          <Mic className="relative h-4 w-4 text-status-success" />
        </span>
      )}

      {micState === "permission-denied" && (
        <p className="mt-1 text-caption text-status-danger" role="alert">
          Microphone access denied. Allow access in your browser settings to dictate notes.
        </p>
      )}
    </div>
  );
}

export default NotesFieldWithMic;
