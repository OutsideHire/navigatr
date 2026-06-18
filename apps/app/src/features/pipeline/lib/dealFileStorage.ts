import { supabase } from "@/lib/supabase";

const BUCKET = "deal-files";

/** Upload a file under the deal's folder; returns the object path. */
export async function uploadDealFile(file: File, dealId: string): Promise<string> {
  const path = `${dealId}/${crypto.randomUUID()}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

/** Short-lived signed URL for download (private bucket). */
export async function signedUrlFor(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) throw error ?? new Error("Could not sign deal-file URL");
  return data.signedUrl;
}

/** Remove a deal-file object from storage. */
export async function removeDealFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
