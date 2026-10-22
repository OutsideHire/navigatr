/**
 * sessionPresence: lets error reporting ask "did the app hold a session just
 * now?" without importing the auth store (which imports the Supabase client and
 * would drag it into every module that reports an error).
 *
 * The auth store registers the probe at import time. Until it does, and if the
 * probe ever throws, the answer is "yes": that keeps reporting exactly as it was,
 * so a wiring mistake can only cause noise, never hide a real error.
 */
let probe: (() => boolean) | null = null;

export function setSessionPresenceProbe(next: (() => boolean) | null): void {
  probe = next;
}

export function hasSessionNow(): boolean {
  if (!probe) return true;
  try {
    return probe();
  } catch {
    return true;
  }
}
