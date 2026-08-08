// Shared push-token resolver for the calendar write-back functions
// (sync_appointment / sync_followup / sync_path). Resolves which calendar a
// rep's navigatr item should be pushed to and a currently-valid access token
// for it, mirroring the per-function google-only resolver they used before but
// provider-aware. Returns null → the caller's existing "needs_reconnect" path.
import { getProvider, type CalendarProviderId } from "./calendarProviders/index.ts";
import { pickPushProvider } from "./calendarProviders/pickPushProvider.ts";
import type { TokenBundle } from "./googleToken.ts";

// Loosely-typed Supabase clients (Deno edge runtime; avoids a generated-types dep).
// deno-lint-ignore no-explicit-any
type SupaClient = any;

const CREDS: Record<CalendarProviderId, { id: string; secret: string }> = {
  google: {
    id: Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") ?? "",
    secret: Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") ?? "",
  },
  microsoft: {
    id: Deno.env.get("MICROSOFT_CALENDAR_CLIENT_ID") ?? "",
    secret: Deno.env.get("MICROSOFT_CALENDAR_CLIENT_SECRET") ?? "",
  },
};

export interface PushToken {
  provider: CalendarProviderId;
  accessToken: string;
}

/**
 * @param existingProvider the provider that already owns this item's mirror
 *   (from the row's *_calendar_provider column), or null for an unsynced item.
 */
export async function resolvePushToken(
  userClient: SupaClient,
  svc: SupaClient,
  userId: string,
  existingProvider: CalendarProviderId | null,
): Promise<PushToken | null> {
  const { data: rows } = await userClient
    .from("oauth_connections")
    .select("id, provider, status")
    .eq("user_id", userId)
    .in("provider", ["google", "microsoft"]);

  const active = ((rows ?? []) as Array<{ id: string; provider: CalendarProviderId; status?: string }>)
    .filter((r) => r.status === "active");
  // The rep's chosen primary calendar (null = auto). Honored by the resolver
  // when that provider is still active, else it falls back to the auto rule.
  const { data: prof } = await userClient
    .from("profiles")
    .select("primary_calendar_provider")
    .eq("id", userId)
    .maybeSingle();
  const primary = (prof?.primary_calendar_provider ?? null) as CalendarProviderId | null;
  const provider = pickPushProvider(active.map((r) => r.provider), existingProvider, primary);
  if (!provider) return null;
  const connectionId = active.find((r) => r.provider === provider)!.id;

  try {
    const { data: bundleJson } = await svc.rpc("oauth_token_get", { p_connection_id: connectionId });
    if (!bundleJson) return null;
    const creds = CREDS[provider];
    const fresh = await getProvider(provider).refreshAccessToken(bundleJson as TokenBundle, {
      clientId: creds.id,
      clientSecret: creds.secret,
    });
    if (fresh.refreshed) {
      await svc.rpc("oauth_token_set", { p_connection_id: connectionId, p_token: fresh.bundle });
      await svc
        .from("oauth_connections")
        .update({ last_refreshed_at: new Date().toISOString() })
        .eq("id", connectionId);
    }
    return { provider, accessToken: fresh.accessToken };
  } catch {
    return null;
  }
}
