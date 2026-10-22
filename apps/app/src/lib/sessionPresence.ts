/**
 * sessionPresence: lets error reporting ask "does the app believe a user is
 * signed in right now?" without importing the auth store (which imports the
 * Supabase client and would drag it into every module that reports an error).
 *
 * Keyed on the app's USER, not on a confirmed session: an anon 42501 while the
 * app shows a signed-in rep (including one held on their stored session while
 * reconnecting) is the #185 "token failed to attach" signal and must report.
 * Only a 42501 after the app has let go of the user is the expected tail of a
 * sign-out.
 *
 * The auth store registers the probe at import time. Until it does, and if the
 * probe ever throws, the answer is "yes": that keeps reporting exactly as it was,
 * so a wiring mistake can only cause noise, never hide a real error.
 */
let probe: (() => boolean) | null = null;

export function setSignedInProbe(next: (() => boolean) | null): void {
  probe = next;
}

export function appBelievesSignedIn(): boolean {
  if (!probe) return true;
  try {
    return probe();
  } catch {
    return true;
  }
}
