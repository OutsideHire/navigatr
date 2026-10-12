/**
 * The server treats a form token younger than 3 seconds as a bot and answers
 * with a fake success, writing nothing. A person who sends right after the
 * form (re)loaded would lose their referral without knowing it, so the page
 * waits until its token is at least 3.5 seconds old before sending.
 */
import { PUBLIC_FORM_MIN_AGE_MS } from "../../../../../../supabase/functions/_shared/portalPublicForm";

export const PUBLIC_SEND_GUARD_MS = PUBLIC_FORM_MIN_AGE_MS + 500;

export function sendDelay(loadedAtMs: number, nowMs: number): number {
  return Math.max(0, loadedAtMs + PUBLIC_SEND_GUARD_MS - nowMs);
}

export function waitForFormAge(
  loadedAtMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const ms = sendDelay(loadedAtMs, now());
  return ms > 0 ? sleep(ms) : Promise.resolve();
}
