/**
 * useVoiceDictation — record a short clip, transcribe it in one backend call,
 * hand back the text. Composes the shared useVoiceRecorder (MediaRecorder
 * capture) with the `transcribe` edge function (AssemblyAI behind a swappable
 * boundary). Batch, not streaming: tap to start, tap to stop, text arrives a
 * moment later. The audio is never persisted — it is base64'd, sent, and the
 * server discards it after transcription.
 *
 * State machine (surfaced as MicState for NotesFieldWithMic):
 *   rest → recording → transcribing → rest (text delivered via onResult)
 *   recording → permission-denied  (getUserMedia refused)
 *   transcribing → error           (network / vendor failure; text box still works)
 */

import * as React from "react";
import { supabase } from "@/lib/supabase";
import { useVoiceRecorder } from "./useVoiceRecorder";

export type DictationState = "rest" | "recording" | "transcribing" | "error" | "permission-denied";

/** Append dictated text to whatever is already in the field, without gluing
 *  words together. Empty additions are ignored; existing trailing whitespace is
 *  respected so we do not double-space. */
export function appendDictated(existing: string, addition: string): string {
  const add = addition.trim();
  if (!add) return existing;
  if (!existing.trim()) return add;
  return /\s$/.test(existing) ? existing + add : existing + " " + add;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000; // avoid arg-count blowups on String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

interface TranscribeResponse {
  text?: string;
  error?: string;
}

export interface UseVoiceDictationOptions {
  /** Called with the transcribed text when a clip finishes transcribing. */
  onResult: (text: string) => void;
}

export function useVoiceDictation({ onResult }: UseVoiceDictationOptions) {
  const recorder = useVoiceRecorder();
  const [phase, setPhase] = React.useState<"idle" | "transcribing" | "error">("idle");

  // Keep the latest onResult without re-triggering the transcribe effect.
  const onResultRef = React.useRef(onResult);
  onResultRef.current = onResult;
  // Guard so each finished recording is transcribed exactly once.
  const handledRef = React.useRef<Blob | null>(null);

  const { state: recState, blob, mimeType, reset } = recorder;

  React.useEffect(() => {
    if (recState !== "recorded" || !blob || handledRef.current === blob) return;
    handledRef.current = blob;
    let cancelled = false;
    (async () => {
      setPhase("transcribing");
      try {
        const audio = await blobToBase64(blob);
        const { data, error } = await supabase.functions.invoke<TranscribeResponse>("transcribe", {
          body: { audio, mime: mimeType },
        });
        if (cancelled) return;
        if (error || !data || data.error || typeof data.text !== "string") {
          setPhase("error");
          return;
        }
        const text = data.text.trim();
        if (text) onResultRef.current(text);
        setPhase("idle");
        reset();
        handledRef.current = null;
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recState, blob, mimeType, reset]);

  const micState: DictationState =
    phase === "transcribing"
      ? "transcribing"
      : phase === "error"
        ? "error"
        : recState === "recording"
          ? "recording"
          : recState === "denied"
            ? "permission-denied"
            : "rest";

  const toggle = React.useCallback(() => {
    if (phase === "transcribing") return; // busy — ignore taps until text arrives
    if (recState === "recording") {
      recorder.stop();
    } else {
      setPhase("idle");
      handledRef.current = null;
      reset();
      void recorder.start();
    }
  }, [phase, recState, recorder, reset]);

  return { micState, toggle };
}
