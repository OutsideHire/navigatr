// transcribe: batch speech-to-text for the voice-note dictation feature.
//
// Receives a base64 audio clip from an authenticated user, sends it to the STT
// vendor, and returns the transcript text. The audio is never persisted: it
// lives in memory for the request only and is dropped after transcription. The
// vendor API key lives here as a Supabase secret and is never shipped to the
// browser. Mirrors geocode's CORS/auth/json shape.
//
// The vendor call lives in _shared/transcribe.ts (also used by portal_api's
// transcribe action for partners).
//
// TRANSCRIBE_MOCK=1 returns fixed text so dev/CI never hit the vendor (mirrors
// GEOCODE_MOCK). ASSEMBLYAI_API_KEY must be set for real transcription.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MAX_AUDIO_BYTES,
  MOCK_TRANSCRIPT,
  base64ToBytes,
  transcribeWithAssemblyAI,
} from "../_shared/transcribe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ASSEMBLYAI_API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";
const TRANSCRIBE_MOCK = Deno.env.get("TRANSCRIBE_MOCK") === "1";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  const body = (await req.json().catch(() => null)) as { audio?: unknown } | null;
  const audioB64 = typeof body?.audio === "string" ? body.audio : "";
  if (!audioB64) return json({ error: "invalid_body", detail: "audio is required" }, 400);

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(audioB64);
  } catch {
    return json({ error: "invalid_body", detail: "audio is not valid base64" }, 400);
  }
  if (bytes.length === 0) return json({ error: "invalid_body", detail: "audio is empty" }, 400);
  if (bytes.length > MAX_AUDIO_BYTES) return json({ error: "audio_too_large" }, 413);

  // Authenticated users only: same gate as geocode/discover_prospects.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  if (TRANSCRIBE_MOCK) {
    return json({ text: MOCK_TRANSCRIPT });
  }

  try {
    const text = await transcribeWithAssemblyAI(bytes, {
      fetch: (input, init) => fetch(input, init),
      apiKey: ASSEMBLYAI_API_KEY,
    });
    return json({ text });
  } catch (e) {
    return json({ error: "transcription_failed", detail: String((e as Error)?.message ?? e) }, 502);
  }
});
