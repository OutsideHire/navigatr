/**
 * intercomAttributes. Pure mapper from our auth/profile shape to the
 * Intercom Messenger boot object.
 *
 * Kept deliberately free of globals, the SDK, and env reads so it is
 * trivially unit-testable. The boot hook (useIntercom) gathers the raw
 * values (user, profile, verified hash) and hands them here; this module
 * only decides what the Intercom payload looks like.
 *
 * Intercom conventions this encodes:
 *   - `created_at` is a UNIX timestamp in SECONDS (not milliseconds).
 *   - `user_hash` (identity verification HMAC) must be OMITTED entirely
 *     when we don't have one. Sending an empty/null hash to a workspace
 *     that enforces identity verification is rejected, so we drop the key.
 *   - Custom attributes (role, role_level, org_id, profession) live at the
 *     TOP LEVEL of the settings object, alongside the standard fields.
 */

/** Raw input, mirroring what useAuth + useProfile expose. */
export interface BuildIntercomInput {
  /** Intercom workspace app id (from VITE_INTERCOM_APP_ID). */
  appId: string;
  /** Supabase auth user id. Becomes Intercom's `user_id`. */
  userId: string;
  /** Display name. Omitted from the payload when null/undefined. */
  name?: string | null;
  /** Email. Omitted from the payload when null/undefined. */
  email?: string | null;
  /** ISO timestamp of account creation. Converted to UNIX seconds. */
  createdAtIso?: string | null;
  /**
   * Verified identity HMAC from the intercom_user_hash Edge function.
   * When null (server secret unset, or the call failed) the key is omitted.
   */
  userHash?: string | null;
  /** Custom attributes, each omitted when null/undefined. */
  role?: string | null;
  roleLevel?: string | null;
  orgId?: string | null;
  profession?: string | null;
}

/**
 * Intercom Messenger boot settings we produce. Compatible with the SDK's
 * InitType (which is app_id + user fields + an open string-index for custom
 * attributes), but declared locally so the pure mapper carries no SDK import.
 */
export interface IntercomSettings {
  app_id: string;
  user_id: string;
  name?: string;
  email?: string;
  created_at?: number;
  user_hash?: string;
  // Custom attributes, flattened at the top level per Intercom convention.
  role?: string;
  role_level?: string;
  org_id?: string;
  profession?: string;
}

/** Convert an ISO date string to a UNIX timestamp in seconds, or null if invalid. */
function toUnixSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * Map our internal shape to the Intercom boot object. Pure: no globals, no
 * env reads, no side effects. Absent (null/undefined) optional values are
 * omitted so Intercom never receives empty strings or a blank user_hash.
 */
export function buildIntercomSettings(input: BuildIntercomInput): IntercomSettings {
  const settings: IntercomSettings = {
    app_id: input.appId,
    user_id: input.userId,
  };

  if (input.name != null) settings.name = input.name;
  if (input.email != null) settings.email = input.email;

  const createdAt = toUnixSeconds(input.createdAtIso);
  if (createdAt != null) settings.created_at = createdAt;

  // Only attach the identity HMAC when we actually have one. A null hash
  // means the server secret is unset or the fetch failed; sending it would
  // break identity verification, so we omit the key entirely.
  if (input.userHash != null) settings.user_hash = input.userHash;

  if (input.role != null) settings.role = input.role;
  if (input.roleLevel != null) settings.role_level = input.roleLevel;
  if (input.orgId != null) settings.org_id = input.orgId;
  if (input.profession != null) settings.profession = input.profession;

  return settings;
}
