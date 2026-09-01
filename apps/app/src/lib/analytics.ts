/**
 * analytics — provider-agnostic product-event tracker.
 *
 * Layer 1 forwards custom events to Vercel Web Analytics. Layer 2 (Amplitude,
 * per the tracking plan) will forward behind this SAME function, so call sites
 * never change when a second provider is added.
 *
 * Rules for callers:
 *   - Event names are object_action, lowercase_snake ("deal_created",
 *     "route_planned"). Put context in properties, not the name.
 *   - Properties are PII-FREE: no names, emails, phone numbers, addresses, or
 *     free-text note content. Identify a rep by their opaque auth user id only,
 *     the same discipline as the Sentry PII scrubbing.
 *   - Analytics must NEVER break the app: every send is best-effort.
 *
 * Page views + SPA route changes are captured automatically by the <Analytics/>
 * component mounted in main.tsx; this function is only for explicit events.
 */
import { track as vercelTrack } from "@vercel/analytics";

/** Vercel custom-event properties: flat scalars only (keeps PII + nesting out). */
export type EventProps = Record<string, string | number | boolean | null>;

export function track(event: string, props?: EventProps): void {
  try {
    vercelTrack(event, props);
  } catch {
    // Best-effort: a failed analytics send must never surface to the user.
  }
}
