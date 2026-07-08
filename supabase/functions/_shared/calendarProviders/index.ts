import type { CalendarProvider, CalendarProviderId } from "./types.ts";
import { googleProvider } from "./google.ts";
import { microsoftProvider } from "./microsoft.ts";

const REGISTRY: Record<CalendarProviderId, CalendarProvider> = {
  google: googleProvider,
  microsoft: microsoftProvider,
};

export function getProvider(id: CalendarProviderId): CalendarProvider {
  const p = REGISTRY[id];
  if (!p) throw new Error(`unknown calendar provider: ${id}`);
  return p;
}
export type { CalendarProvider, CalendarProviderId } from "./types.ts";
