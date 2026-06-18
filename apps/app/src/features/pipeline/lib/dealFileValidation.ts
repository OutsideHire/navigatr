export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = [
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export function validateFile(
  file: { size: number; type: string },
): { ok: true } | { ok: false; reason: string } {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: "File is larger than 10MB." };
  const ok = file.type.startsWith("image/") || ALLOWED_TYPES.includes(file.type);
  if (!ok) return { ok: false, reason: "Unsupported file type." };
  return { ok: true };
}
