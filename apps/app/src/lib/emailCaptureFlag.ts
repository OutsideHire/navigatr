/**
 * Client flag for the Automatic Email Activity Capture surfaces (PRD D-07).
 * OFF unless VITE_EMAIL_CAPTURE is exactly "true", so the whole feature (the
 * Activities suggestion list and the Outlook at-connect disclosure) ships dark
 * until the flag is set. Shared so every surface reads one source of truth.
 */
export const EMAIL_CAPTURE_UI_ENABLED =
  import.meta.env.VITE_EMAIL_CAPTURE === "true";
