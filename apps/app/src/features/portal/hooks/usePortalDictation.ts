/**
 * usePortalDictation: voice notes on the partner's submit form (spec 5.5, brief D6).
 *
 * Same recorder and state machine as the app's useVoiceDictation, but the clip
 * goes to portal_api's transcribe action with the partner's portal session. It
 * never calls the rep-only transcribe function, which requires an internal
 * user's JWT. Drives NotesFieldWithMic in manual mode (onMicClick + micState).
 * A 401 goes to onUnauthorized (the layout's expire); a 413 sets tooLong so the
 * form can say the clip was too long rather than a generic failure.
 */
import * as React from "react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { blobToBase64, type DictationState } from "@/hooks/useVoiceDictation";
import { PortalApiError, isPortalUnauthorized, portalApi } from "../lib/portalApi";

export interface UsePortalDictationOptions {
  slug: string;
  token: string;
  onResult: (text: string) => void;
  /** Called when transcribe answers 401: the session is gone. */
  onUnauthorized?: () => void;
}

export function usePortalDictation({ slug, token, onResult, onUnauthorized }: UsePortalDictationOptions) {
  const recorder = useVoiceRecorder();
  const [phase, setPhase] = React.useState<"idle" | "transcribing" | "error">("idle");
  const [tooLong, setTooLong] = React.useState(false);

  // Keep the latest callbacks without re-running the transcribe effect.
  const onResultRef = React.useRef(onResult);
  onResultRef.current = onResult;
  const onUnauthorizedRef = React.useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
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
      } catch (err) {
        if (cancelled) return;
        if (isPortalUnauthorized(err)) {
          setPhase("idle");
          onUnauthorizedRef.current?.();
          return;
        }
        setTooLong(err instanceof PortalApiError && err.status === 413);
        setPhase("error");
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
      setTooLong(false);
      handledRef.current = null;
      reset();
      void recorder.start();
    }
  }, [phase, recState, recorder, reset]);

  return { micState, toggle, tooLong };
}
