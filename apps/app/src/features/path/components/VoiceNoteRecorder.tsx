import * as React from "react";
import { Mic, Square, Trash2, MicOff } from "lucide-react";
import type { RecorderState } from "../hooks/useVoiceRecorder";

interface VoiceNoteRecorderProps {
  state: RecorderState;
  durationMs: number;
  blob: Blob | null;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Voice-note recorder shown ABOVE the disposition tiles in the drop-in sheet.
 *  Presentational — the parent owns the useVoiceRecorder state + the blob. */
export function VoiceNoteRecorder({ state, durationMs, blob, onStart, onStop, onReset }: VoiceNoteRecorderProps) {
  const audioUrl = React.useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  React.useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  return (
    <div className="flex flex-col gap-2 rounded-radius-md border border-border-subtle bg-surface-sunken/40 p-3">
      <span className="text-caption font-medium text-text-muted">Voice note (optional)</span>
      {state === "idle" && (
        <button type="button" onClick={onStart} className="inline-flex items-center gap-2 self-start rounded-radius-md bg-brand-primary px-3 py-2 text-body-sm font-medium text-brand-primary-foreground">
          <Mic className="h-4 w-4" aria-hidden /> Record a voice note
        </button>
      )}
      {state === "recording" && (
        <div className="flex items-center gap-3">
          <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-radius-full bg-status-danger" aria-hidden />
          <span className="text-body-sm tabular-nums text-text-default">{fmt(durationMs)}</span>
          <button type="button" onClick={onStop} className="inline-flex items-center gap-2 rounded-radius-md border border-border-default px-3 py-1.5 text-body-sm">
            <Square className="h-3.5 w-3.5" aria-hidden /> Stop
          </button>
        </div>
      )}
      {state === "recorded" && audioUrl && (
        <div className="flex items-center gap-3">
          <audio controls src={audioUrl} className="h-9 flex-1" />
          <button type="button" aria-label="Delete voice note" onClick={onReset} className="rounded-radius-sm p-1.5 text-text-subtle hover:text-status-danger">
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {state === "denied" && (
        <p className="inline-flex items-center gap-2 text-caption text-status-danger">
          <MicOff className="h-4 w-4" aria-hidden /> Microphone is blocked — enable mic access to record.
        </p>
      )}
    </div>
  );
}
