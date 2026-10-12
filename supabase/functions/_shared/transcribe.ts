/**
 * Batch speech-to-text through AssemblyAI (voice-note dictation).
 *
 * Shared by the rep-facing `transcribe` edge function and portal_api's
 * `transcribe` action (Partner Portal Phase 1B, spec 5.5). The vendor lives here
 * only: swapping to another provider later is a change in this file. Audio is
 * never persisted; it is uploaded, transcribed, and dropped.
 *
 * Pure TS with injected fetch and clock and no Deno globals, so vitest covers it.
 */
const AAI_BASE = "https://api.assemblyai.com/v2";

// About 2 minutes of webm/opus is well under a couple of MB; base64 inflates it
// by a third. Cap the decoded payload (10 MB) so a bad client can't spool us.
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;

// Partners dictate a short note, not a meeting. The portal path caps decoded
// audio at 2 MB (about 2 minutes of webm/opus) to bound vendor cost; the rep
// function keeps the 10 MB cap above.
export const PORTAL_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const PORTAL_MAX_AUDIO_BASE64_CHARS = Math.ceil(PORTAL_MAX_AUDIO_BYTES / 3) * 4;

export const MOCK_TRANSCRIPT = "This is a mock transcription for local development.";

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_TIMEOUT_MS = 45_000;

/** Throws on input that is not valid base64. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export interface AssemblyAIDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  apiKey: string;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/** Upload bytes, create the transcript job, poll until it completes. Throws on vendor error or timeout. */
export async function transcribeWithAssemblyAI(audio: Uint8Array<ArrayBuffer>, deps: AssemblyAIDeps): Promise<string> {
  if (!deps.apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY not set (and TRANSCRIBE_MOCK != 1)");
  }
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nowMs = deps.nowMs ?? (() => Date.now());
  const pollInterval = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pollTimeout = deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const auth = { authorization: deps.apiKey };

  // 1. Upload the raw audio bytes.
  const up = await deps.fetch(`${AAI_BASE}/upload`, { method: "POST", headers: auth, body: audio });
  if (!up.ok) throw new Error(`upload http ${up.status}`);
  const { upload_url } = (await up.json()) as { upload_url?: string };
  if (!upload_url) throw new Error("upload returned no url");

  // 2. Create the transcript job. English; punctuation and formatting on.
  const create = await deps.fetch(`${AAI_BASE}/transcript`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, punctuate: true, format_text: true }),
  });
  if (!create.ok) throw new Error(`create http ${create.status}`);
  const created = (await create.json()) as { id?: string };
  if (!created.id) throw new Error("create returned no id");

  // 3. Poll until the job completes (short clips finish in a few seconds).
  const deadline = nowMs() + pollTimeout;
  while (nowMs() < deadline) {
    const poll = await deps.fetch(`${AAI_BASE}/transcript/${created.id}`, { headers: auth });
    if (!poll.ok) throw new Error(`poll http ${poll.status}`);
    const t = (await poll.json()) as { status?: string; text?: string; error?: string };
    if (t.status === "completed") return t.text ?? "";
    if (t.status === "error") throw new Error(t.error ?? "transcription error");
    await sleep(pollInterval);
  }
  throw new Error("transcription timed out");
}
