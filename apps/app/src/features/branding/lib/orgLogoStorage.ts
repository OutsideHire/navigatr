/**
 * orgLogoStorage: upload an org's logo to the PUBLIC `org-logos` bucket and
 * return the public URL to store on org_branding.
 *
 * Public (unlike deal-files / voice-notes, which are private + signed) because
 * a logo has to render on the top bar without a signed URL. It holds only
 * non-sensitive brand art. Writes are admin-only + org-scoped by the bucket's
 * RLS policy (migration 20260904000001); the path MUST start with the org id
 * for that policy to allow the write.
 *
 * Paths are timestamped (`<orgId>/<variant>-<ts>.<ext>`) so each upload is a
 * new object with a fresh public URL, so there is no CDN/browser cache staleness when an
 * admin replaces the logo. (Old objects are left in place; a prune job can
 * reclaim them later.)
 */
import { supabase } from "@/lib/supabase";

export const LOGO_BUCKET = "org-logos";
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
export const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

export type LogoVariant = "logo" | "dark-logo";

/** Client-side guard mirroring the accepted types + size cap. Returns a
 *  human-readable error string, or null when the file is acceptable. */
export function validateLogoFile(file: File): string | null {
  if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
    return "Use a PNG, JPG, SVG, or WebP image.";
  }
  if (file.size > MAX_LOGO_BYTES) {
    return "That image is over 2 MB. Try a smaller one.";
  }
  return null;
}

function extForFile(file: File): string {
  switch (file.type) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/svg+xml": return "svg";
    case "image/webp": return "webp";
    default: {
      const dot = file.name.lastIndexOf(".");
      return dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "png";
    }
  }
}

/**
 * Upload a validated logo file. Throws if validation fails or the upload
 * errors. Returns the public URL to persist via update_org_branding.
 */
export async function uploadOrgLogo(
  file: File,
  orgId: string,
  variant: LogoVariant,
): Promise<string> {
  const invalid = validateLogoFile(file);
  if (invalid) throw new Error(invalid);

  const path = `${orgId}/${variant}-${Date.now()}.${extForFile(file)}`;
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
