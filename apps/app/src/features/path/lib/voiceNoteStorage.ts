import { supabase } from "@/lib/supabase";

const BUCKET = "voice-notes";
const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/webm;codecs=opus": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};

export function extFor(mimeType: string): string {
  return EXT[mimeType] ?? "webm";
}

/** Upload a voice-note blob under the user's own folder; returns the object path. */
export async function uploadVoiceNote(blob: Blob, mimeType: string, userId: string): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}.${extFor(mimeType)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mimeType });
  if (error) throw error;
  return path;
}

/** Short-lived signed URL for playback (private bucket). */
export async function signedUrlFor(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) throw error ?? new Error("Could not sign voice-note URL");
  return data.signedUrl;
}
