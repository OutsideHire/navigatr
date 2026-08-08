import type { CalendarProviderId } from "./types.ts";

/**
 * Choose which calendar to push a navigatr item to, given the rep's currently
 * active connections and (if any) the provider that already owns this item's
 * mirror. Push targets exactly one calendar to avoid duplicate events.
 *
 * Precedence:
 *   1. If the item already has a mirror on a still-active provider, keep it
 *      there (never orphan an existing event by switching providers).
 *   2. Otherwise honor the rep's chosen primary when that provider is still
 *      active, so reps who prefer Outlook finally get their events there.
 *   3. Otherwise prefer Google when both are connected (the incumbent), so
 *      today's behavior for Google-only reps (and reps with no primary) is
 *      unchanged.
 *   4. Otherwise the single active provider.
 * Returns null when the rep has no active calendar (→ needs_reconnect).
 */
export function pickPushProvider(
  active: CalendarProviderId[],
  existingProvider: CalendarProviderId | null,
  primary: CalendarProviderId | null = null,
): CalendarProviderId | null {
  const set = new Set(active);
  if (set.size === 0) return null;
  if (existingProvider && set.has(existingProvider)) return existingProvider;
  if (primary && set.has(primary)) return primary;
  if (set.has("google")) return "google";
  if (set.has("microsoft")) return "microsoft";
  return null;
}
