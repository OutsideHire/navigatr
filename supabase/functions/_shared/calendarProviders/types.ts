import type { RawCalendarEvent } from "../calendarQualify.ts";
import type { TokenBundle } from "../googleToken.ts";
import type { AppointmentForEvent, FollowupDealForEvent, PathForBlockEvent } from "../googleEvent.ts";

export type CalendarProviderId = "google" | "microsoft";

/**
 * A navigatr item to mirror into a calendar, normalized across providers. A
 * discriminated union over the three push-out kinds; each carries exactly the
 * native inputs the Google builders already take, so the Google event JSON is
 * reproduced byte-for-byte and Microsoft builds the equivalent Graph body.
 */
export type CalendarEventInput =
  | { kind: "appointment"; appt: AppointmentForEvent; attendeeEmails: string[]; timeZone: string }
  | { kind: "followup"; deal: FollowupDealForEvent; followUpDateISO: string }
  | { kind: "path"; path: PathForBlockEvent };

export interface UpsertResult {
  id: string;
}

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
  /**
   * List events in [windowStart,windowEnd] (ISO) as normalized RawCalendarEvent[].
   * `options.excludeCalendarIds` names calendars that must NEVER be queried (Google
   * filters these out of the calendarList before issuing any events.list request, so
   * a personal/shared calendar's 403/404 can't drop the whole read and its event
   * bodies are never fetched). Providers without a calendar-list concept ignore it.
   */
  listEvents(
    accessToken: string,
    windowStart: string,
    windowEnd: string,
    options?: { excludeCalendarIds?: string[] },
  ): Promise<RawCalendarEvent[]>;
  /**
   * Create (when `existingEventId` is null) or update the mirrored event for a
   * navigatr item on the rep's PRIMARY calendar. Returns the provider event id.
   * Throws on a hard failure; the caller records the sync error + status.
   */
  upsertEvent(
    accessToken: string,
    existingEventId: string | null,
    input: CalendarEventInput,
  ): Promise<UpsertResult>;
  /** Delete the mirrored event. Idempotent: an already-gone event is success. */
  deleteEvent(accessToken: string, eventId: string): Promise<void>;
}
