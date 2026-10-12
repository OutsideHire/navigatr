/**
 * usePortalDictation: voice notes on the partner's submit form (spec 5.5, brief D6).
 *
 * Same recorder and state machine as the app's useVoiceDictation, but the clip
 * goes to portal_api's transcribe action with the partner's portal session. It
 * never calls the rep-only transcribe function, which requires an internal
 * user's JWT. Drives NotesFieldWithMic in manual mode (onMicClick + micState).
 */
import * as React from "react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { blobToBase64, type DictationState } from "@/hooks/useVoiceDictation";
import { portalApi } from "../lib/portalApi";

export interface UsePortalDictationOptions {
  slug: string;
  token: string;
  onResult: (text: string) => void;
}

export function usePortalDictation({ slug, token, onResult }: UsePortalDictationOptions) {
  const recorder = useVoiceRecorder();
  const [phase, setPhase] = React.useState<"idle" | "transcribing" | "error">("idle");

  // Keep the latest onResult without re-running the transcribe effect.
  const onResultRef = React.useRef(onResult);
  onResultRef.current = onResult;
  // Each finished recording is transcribed exactly once.
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
        const text = (await portalApi.transcribe(slug, token, audio, mimeType)).trim();
        if (cancelled) return;
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
  }, [recState, blob, mimeType, reset, slug, token]);

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
    if (phase === "transcribing") return;
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
