/**
 * useIntercom. Boots the Intercom Messenger for signed-in users with a
 * verified identity + attributes, and shuts it down on sign-out.
 *
 * Design:
 *   - Ship-dark gate: the messenger only ever loads when
 *     `VITE_INTERCOM_APP_ID` is set. With no app id (the default in this
 *     repo) the hook does nothing (no fetch, no SDK boot, no launcher).
 *   - Verified identity: for a signed-in user we fetch the identity HMAC
 *     from the `intercom_user_hash` Edge function. A failed/null response
 *     is tolerated (treated as no hash) so the messenger still boots.
 *   - Shared-device safety: when the user becomes null (sign-out) we call
 *     the SDK's shutdown() so the prior session's conversations don't carry
 *     over. A new sign-in re-boots with the new identity.
 *
 * Mounted inside AppLayout so it only runs behind ProtectedRoute (authed
 * shell). It renders nothing; the Intercom floating launcher is the UI.
 */

import { useEffect, useRef } from "react";
import Intercom, { shutdown, update } from "@intercom/messenger-js-sdk";
import { supabase } from "@/lib/supabase";
import { useAuth, getProfession } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { buildIntercomSettings } from "./lib/intercomAttributes";

/** Read the configured Intercom app id, or null when unset/empty (ship-dark). */
function getAppId(): string | null {
  const id = import.meta.env.VITE_INTERCOM_APP_ID;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

/**
 * Best-effort fetch of the verified identity hash. Returns null on any
 * failure (function down, network error, secret unset) so the caller can
 * still boot the messenger without verification.
 */
async function fetchUserHash(): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ user_hash: string | null }>(
      "intercom_user_hash",
      { body: {} },
    );
    if (error) return null;
    return data?.user_hash ?? null;
  } catch {
    return null;
  }
}

export function useIntercom(): void {
  const user = useAuth((s) => s.user);
  const { data: profile } = useProfile();

  // Track which user id the Messenger is currently booted for, so the first
  // apply for a user is a boot and later applies (once the profile resolves)
  // are attribute updates rather than re-boots.
  const bootedForRef = useRef<string | null>(null);

  // Cache the verified identity hash per user id. The hash only depends on
  // user.id, so we fetch it ONCE per user (storing the in-flight promise) and
  // reuse it when the profile resolving re-runs this effect. Without this, a
  // profile change would refetch the hash on every render.
  const hashCacheRef = useRef<{ userId: string; promise: Promise<string | null> } | null>(null);

  useEffect(() => {
    const appId = getAppId();
    // Ship-dark: no app id => never touch Intercom at all.
    if (!appId) return;

    // Signed out: shut the messenger down (once) so a shared device doesn't
    // carry the prior session, then reset so the next sign-in re-boots.
    if (!user) {
      if (bootedForRef.current !== null) {
        shutdown();
        bootedForRef.current = null;
      }
      return;
    }

    // Switching identities without a sign-out in between: tear down the
    // previous user's session first so conversations and attributes never
    // bleed across users, then fall through to boot the new one.
    if (bootedForRef.current !== null && bootedForRef.current !== user.id) {
      shutdown();
      bootedForRef.current = null;
    }

    // Fetch (or reuse) the identity hash for this user id exactly once.
    let cache = hashCacheRef.current;
    if (!cache || cache.userId !== user.id) {
      cache = { userId: user.id, promise: fetchUserHash() };
      hashCacheRef.current = cache;
    }
    const hashPromise = cache.promise;

    let cancelled = false;

    void (async () => {
      const userHash = await hashPromise;
      // The user may have signed out, switched, or this run may have been
      // superseded by a profile change while the hash was in flight; bail so
      // we never apply a stale identity's settings.
      if (cancelled || useAuth.getState().user?.id !== user.id) return;

      const settings = buildIntercomSettings({
        appId,
        userId: user.id,
        name: profile?.full_name ?? null,
        email: user.email ?? null,
        createdAtIso: profile?.created_at ?? null,
        userHash,
        role: profile?.role ?? null,
        roleLevel: profile?.role_level ?? null,
        orgId: profile?.org_id ?? null,
        profession: getProfession(user),
      });

      if (bootedForRef.current !== user.id) {
        // First apply for this user: full boot.
        Intercom(settings);
        bootedForRef.current = user.id;
      } else {
        // Already booted for this user: refresh attributes in place so the
        // profile fields (name/created_at/role/role_level/org_id) land once
        // the profile query resolves after the initial boot.
        update(settings);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-run when the user identity or the resolved profile changes; each
    // re-run rebuilds settings from the CURRENT user + profile + cached hash
    // and applies them (boot on first apply, update thereafter).
  }, [user, profile]);
}
