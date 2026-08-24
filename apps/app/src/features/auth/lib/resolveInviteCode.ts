/**
 * resolveInviteCode — pick the invite code the /auth/callback should claim,
 * from the three carriers, in precedence order.
 *
 * The bug this fixes: when email confirmation is ON, an invited rep who opens
 * the confirmation link in a NEW TAB or on a DIFFERENT DEVICE has no
 * sessionStorage `pending_invite` (it is per-tab) and no `?invite=` in the URL
 * (Supabase's confirm link redirects without it). Both prior carriers are
 * empty, so the callback claimed an empty code, got `invite_code_required`, and
 * routed the rep to /create-organization — silently creating their OWN org
 * instead of joining the ISO's team.
 *
 * The fix is the third carrier: `user_metadata.invite_code`, set on the auth
 * user at signUp. It travels with the user server-side, so it is present in any
 * tab or device once the session hydrates. Server-side `claim_invite_code`
 * still validates the code, so trusting a user-set metadata field grants no
 * access beyond a genuinely valid invite.
 *
 * Precedence: URL (explicit, freshest) > sessionStorage (same-tab flow) >
 * user_metadata (survives the confirmation round-trip).
 */
export interface InviteCodeSources {
  urlInvite?: string | null;
  stashedInvite?: string | null;
  metaInvite?: string | null;
}

export interface ResolvedInviteCode {
  /** The code to claim ("" when none is present anywhere). */
  code: string;
  /** Whether the user intended to be on the callback (any carrier present). A
   *  bare callback with no carrier is a stale-tab/back-button accident. */
  intentional: boolean;
}

export function resolveInviteCode(sources: InviteCodeSources): ResolvedInviteCode {
  const url = (sources.urlInvite ?? "").trim();
  const stashed = (sources.stashedInvite ?? "").trim();
  const meta = (sources.metaInvite ?? "").trim();
  const code = url || stashed || meta;
  return { code, intentional: Boolean(code) };
}
