import * as React from "react";

export type RecorderState = "idle" | "recording" | "recorded" | "denied";
const CAP_MS = 120_000;
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function pickMimeType(): string {
  const MR = (globalThis as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  if (MR?.isTypeSupported) {
    for (const t of PREFERRED_TYPES) if (MR.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

/** MediaRecorder state machine for a single drop-in voice memo. The parent owns
 *  the resulting blob (for upload). Auto-stops at 2 min; cleans up tracks. */
export function useVoiceRecorder() {
  const [state, setState] = React.useState<RecorderState>("idle");
  const [blob, setBlob] = React.useState<Blob | null>(null);
  const [durationMs, setDurationMs] = React.useState(0);
  const mimeRef = React.useRef<string>("audio/webm");
  const recRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const startedAtRef = React.useRef(0);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const stop = React.useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      mimeRef.current = mimeType;
      const rec = new MediaRecorder(stream, { mimeType });
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        setBlob(new Blob(chunksRef.current, { type: mimeRef.current }));
        setDurationMs(Date.now() - startedAtRef.current);
        setState("recorded");
        cleanupStream();
      };
      startedAtRef.current = Date.now();
      rec.start();
      setState("recording");
      timerRef.current = setTimeout(() => stop(), CAP_MS);
    } catch {
      setState("denied");
      cleanupStream();
    }
  }, [cleanupStream, stop]);

  const reset = React.useCallback(() => {
    cleanupStream();
    recRef.current = null;
    chunksRef.current = [];
    setBlob(null);
    setDurationMs(0);
    setState("idle");
  }, [cleanupStream]);

  React.useEffect(() => () => cleanupStream(), [cleanupStream]);

  return { state, blob, durationMs, mimeType: mimeRef.current, start, stop, reset };
}
