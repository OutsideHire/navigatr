import type { RawCalendarEvent } from "../calendarQualify";
import type { TokenBundle } from "../googleToken";

export type CalendarProviderId = "google" | "microsoft";

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string | null;
  scopes: string[];
  clientIdEnv: string;      // env var name, e.g. "GOOGLE_CALENDAR_CLIENT_ID"
  clientSecretEnv: string;
  /** Provider-specific extra auth-URL params (Google: access_type/prompt/include_granted_scopes; MS: response_mode). */
  extraAuthParams: Record<string, string>;
}

export interface RefreshDeps {
  clientId: string;
  clientSecret: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}
export interface RefreshResult { accessToken: string; bundle: TokenBundle; refreshed: boolean }

export interface CalendarProvider {
  id: CalendarProviderId;
  oauth: OAuthConfig;
  /** Valid token, refreshing via the provider's refresh grant when needed. */
  refreshAccessToken(bundle: TokenBundle, deps: RefreshDeps): Promise<RefreshResult>;
  /** List events in [windowStart,windowEnd] (ISO) as normalized RawCalendarEvent[]. */
  listEvents(accessToken: string, windowStart: string, windowEnd: string): Promise<RawCalendarEvent[]>;
}
