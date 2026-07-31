// transcribe — batch speech-to-text for the voice-note dictation feature.
//
// Receives a base64 audio clip from an authenticated user, sends it to the STT
// vendor (AssemblyAI), and returns the transcript text. The audio is never
// persisted: it lives in memory for the request only and is dropped after
// transcription. The vendor API key lives here as a Supabase secret and is
// never shipped to the browser. Mirrors geocode's CORS/auth/json shape.
//
// The vendor lives entirely inside this file — swapping to Deepgram/ElevenLabs
// later is a change here, not in the app.
//
// TRANSCRIBE_MOCK=1 returns fixed text so dev/CI never hit the vendor (mirrors
// GEOCODE_MOCK). ASSEMBLYAI_API_KEY must be set for real transcription.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const TRANSCRIBE_MOCK = Deno.env.get("TRANSCRIBE_MOCK") === "1";

const AAI_BASE = "https://api.assemblyai.com/v2";
// ~2 min of webm/opus is well under a couple MB; base64 inflates ~33%. Cap the
// decoded payload defensively (10 MB) so a bad client can't spool the function.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 45_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** AssemblyAI batch flow: upload bytes → create transcript → poll to completion.
 *  Returns the transcript text, or throws on vendor error/timeout. */
async function transcribeWithAssemblyAI(audio: Uint8Array): Promise<string> {
  if (!ASSEMBLYAI_API_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY not set (and TRANSCRIBE_MOCK != 1)");
  }
  const auth = { authorization: ASSEMBLYAI_API_KEY };

  // 1. Upload the raw audio bytes.
  const up = await fetch(`${AAI_BASE}/upload`, { method: "POST", headers: auth, body: audio });
  if (!up.ok) throw new Error(`upload http ${up.status}`);
  const { upload_url } = (await up.json()) as { upload_url?: string };
  if (!upload_url) throw new Error("upload returned no url");

  // 2. Create the transcript job. English; punctuation + formatting on.
  const create = await fetch(`${AAI_BASE}/transcript`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, punctuate: true, format_text: true }),
  });
  if (!create.ok) throw new Error(`create http ${create.status}`);
  const created = (await create.json()) as { id?: string };
  if (!created.id) throw new Error("create returned no id");

  // 3. Poll until the job completes (short clips finish in a few seconds).
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const poll = await fetch(`${AAI_BASE}/transcript/${created.id}`, { headers: auth });
    if (!poll.ok) throw new Error(`poll http ${poll.status}`);
    const t = (await poll.json()) as { status?: string; text?: string; error?: string };
    if (t.status === "completed") return t.text ?? "";
    if (t.status === "error") throw new Error(t.error ?? "transcription error");
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("transcription timed out");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  const body = (await req.json().catch(() => null)) as { audio?: unknown } | null;
  const audioB64 = typeof body?.audio === "string" ? body.audio : "";
  if (!audioB64) return json({ error: "invalid_body", detail: "audio is required" }, 400);

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(audioB64);
  } catch {
    return json({ error: "invalid_body", detail: "audio is not valid base64" }, 400);
  }
  if (bytes.length === 0) return json({ error: "invalid_body", detail: "audio is empty" }, 400);
  if (bytes.length > MAX_AUDIO_BYTES) return json({ error: "audio_too_large" }, 413);

  // Authenticated users only — same gate as geocode/discover_prospects.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  if (TRANSCRIBE_MOCK) {
    return json({ text: "This is a mock transcription for local development." });
  }

  try {
    const text = await transcribeWithAssemblyAI(bytes);
    return json({ text });
  } catch (e) {
    return json({ error: "transcription_failed", detail: String((e as Error)?.message ?? e) }, 502);
  }
});
