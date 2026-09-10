/**
 * Auth store — mirrors Supabase SDK state into Zustand for the UI to read.
 *
 * We do NOT manage session persistence ourselves; the Supabase SDK
 * persists its session to localStorage under the key configured in
 * `src/lib/supabase.ts`. This store just subscribes to
 * `onAuthStateChange` and re-renders consumers.
 *
 * Profession (the post-signup onboarding step) is stored in Supabase
 * `user_metadata.profession`. We read it from the User object so it
 * works without the backend running. When the canonical `/api/me`
 * endpoint is wired, this can flip to that.
 */

import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, AUTH_STORAGE_KEY } from "@/lib/supabase";

export type Profession = "payroll" | "merchant_services" | "treasury_management";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;

  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  verifyMagicLinkCode: (email: string, code: string) => Promise<void>;
  signInWithGoogle: (inviteCode?: string) => Promise<void>;
  signInWithMicrosoft: (inviteCode?: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, inviteCode: string) => Promise<{ needsEmailConfirmation: boolean; alreadyRegistered: boolean }>;
  resendSignupEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  setProfession: (profession: Profession) => Promise<void>;
  dismissOnboarding: () => Promise<void>;
  clearError: () => void;
}

/** Extract a user-friendly message from any thrown auth error. */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  error: null,

  signInWithEmail: async (email, password) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Send a passwordless sign-in OTP. The email contains BOTH a 6-digit
   * code and a clickable link (Supabase sends both by default with the
   * built-in "Magic Link" template). Our UI directs the user to type
   * the code into the app — works from any browser, any device, any
   * email client.
   *
   * Why not the clickable link path: with flowType='pkce' (which the
   * client uses), the link contains a `?code=` that requires a verifier
   * stored client-side at request time. If the user clicks the link in
   * a different browser/device than where they requested it (mobile
   * inbox preview, scanning email client, secondary device), the
   * verifier isn't found and Supabase rejects the exchange. The OTP
   * code path is stateless — the code IS the credential — so it works
   * regardless of where the email is opened.
   *
   * shouldCreateUser=false so a typo'd email doesn't silently provision
   * a new auth.users row. Onboarding still requires invite-code signup.
   */
  signInWithMagicLink: async (email) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        // emailRedirectTo is still set so the clickable-link path
        // (which Supabase sends alongside the code) works for users
        // who happen to be in the same browser context. The OTP code
        // is the primary path our UI directs them to.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  /**
   * Verify a 6-digit OTP code the user typed in from the email. On
   * success Supabase establishes a session and the onAuthStateChange
   * listener flips the store's user/session — the LoginForm then
   * navigates to /dashboard.
   *
   * Two robustness notes from live debugging:
   *
   * 1. Email normalization: Supabase stores emails lowercased, so the
   *    verify call MUST match. The login form doesn't enforce case;
   *    a user who typed "Ryan@navigatr.app" earlier and "ryan@..." now
   *    would get a no-match if we passed the raw form value.
   *
   * 2. Type fallback: signInWithOtp({email}) historically emitted OTPs
   *    of type "magiclink"; newer Supabase versions accept "email" for
   *    the same flow. We try "email" first, fall back to "magiclink" on
   *    a "token has expired or is invalid" error — the only failure mode
   *    where the type mismatch is the actual cause and the code is
   *    otherwise correct.
   */
  verifyMagicLinkCode: async (email, code) => {
    set({ error: null });
    const normalizedEmail = email.trim().toLowerCase();
    const token = code.trim();

    const first = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token,
      type: "email",
    });
    if (!first.error) return;

    // Some Supabase project versions expect 'magiclink' for the same
    // OTP flow. Retry once on the specific "invalid" error before
    // surfacing it — saves a debug session for anyone who ships this
    // against an older Supabase instance.
    const errMsg = first.error.message ?? "";
    const looksLikeTypeMismatch =
      /invalid|expired/i.test(errMsg) && !/rate/i.test(errMsg);
    if (looksLikeTypeMismatch) {
      const second = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token,
        type: "magiclink",
      });
      if (!second.error) return;
      // Both failed — prefer the second (more specific) error message.
      set({ error: second.error.message });
      throw second.error;
    }

    set({ error: first.error.message });
    throw first.error;
  },

  signInWithGoogle: async (inviteCode) => {
    set({ error: null });
    // Primary carrier: URL. Fallback: sessionStorage (refresh-recovery).
    // See design doc § "Signup & Org Assignment" — sessionStorage alone
    // breaks in new tabs and Safari ITP. The URL is the source of truth.
    if (inviteCode) sessionStorage.setItem("pending_invite", inviteCode);
    const callback = `${window.location.origin}/auth/callback${
      inviteCode ? `?invite=${encodeURIComponent(inviteCode)}` : ""
    }`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback,
        // Always force the Google account picker. Without this, Google
        // silently signs the user in as their last-active identity in
        // the browser — which is the wrong account for anyone who
        // shares a device, has multiple Google accounts, or just tested
        // signup with a throwaway. The cost of the extra click is far
        // less than the cost of "Sign-in failed: no invite code" because
        // they ended up authed as an account that has no profile.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signInWithMicrosoft: async (inviteCode) => {
    set({ error: null });
    if (inviteCode) sessionStorage.setItem("pending_invite", inviteCode);
    const callback = `${window.location.origin}/auth/callback${
      inviteCode ? `?invite=${encodeURIComponent(inviteCode)}` : ""
    }`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: callback,
        scopes: "email openid profile",
        // Same account-picker fix as Google: force Microsoft to ask
        // which identity, instead of silently picking the browser's
        // last-active one. Microsoft honors the OAuth 2.0 `prompt`
        // param the same way (select_account = show the picker).
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signUp: async (email, password, fullName, inviteCode) => {
    set({ error: null });
    // Email/password path: invite_code travels in user_metadata. The
    // handle_new_user_signup trigger reads it server-side and creates the
    // profiles row (or raises, rolling back the auth.users insert).
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, invite_code: inviteCode },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
    // Supabase anti-enumeration: signing up an email that already has a
    // CONFIRMED account returns no error, no session, and an obfuscated user
    // with an empty `identities` array (and sends NO email). Detect that so the
    // caller says "sign in instead" rather than a "check your email" that never
    // arrives and strands the user. A genuinely new (confirmation-pending) user
    // has exactly one identity and no session; the `?? 1` guards the impossible
    // undefined case so we never falsely flag already-registered.
    const alreadyRegistered = !data.session && (data.user?.identities?.length ?? 1) === 0;
    // No session AND a real new identity = confirmation is required: the caller
    // shows "check your email". Session present = confirm disabled, sign-in
    // completed, proceed to /auth/callback.
    const needsEmailConfirmation = !data.session && !alreadyRegistered;
    return { needsEmailConfirmation, alreadyRegistered };
  },

  // Re-send the signup confirmation email (the "check your email" screen calls
  // this so a lost or spam-filtered first email is not a dead-end). Uses the
  // same emailRedirectTo as signUp; the invite_code already lives in the user's
  // metadata from signUp, so the re-sent link resolves the invite identically.
  resendSignupEmail: async (email) => {
    set({ error: null });
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signOut: async () => {
    set({ error: null });
    const { error } = await supabase.auth.signOut();
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  resetPassword: async (email) => {
    set({ error: null });
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  updatePassword: async (newPassword) => {
    set({ error: null });
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  setProfession: async (profession) => {
    set({ error: null });
    const { data, error } = await supabase.auth.updateUser({
      data: { profession },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
    if (data.user) {
      set((s) => ({ user: data.user, session: s.session }));
    }
  },

  dismissOnboarding: async () => {
    set({ error: null });
    const { data, error } = await supabase.auth.updateUser({
      data: { onboarding_dismissed_at: new Date().toISOString() },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
    if (data.user) {
      set((s) => ({ user: data.user, session: s.session }));
    }
  },

  clearError: () => set({ error: null }),
}));

// ---------------------------------------------------------------------------
// Session recovery
//
// iOS Safari and any WebKit PWA can momentarily report "no session" on resume
// or reload even when a valid refresh token is still sitting in storage
// (supabase-js#1560; ITP storage-availability timing). Left unhandled, that
// transient null makes ProtectedRoute bounce a signed-in rep straight to
// /login: the "it keeps logging me out on my phone" complaint. recoverSession
// actively re-reads the session and, if needed, forces a refresh-token exchange
// BEFORE the app concludes the user is signed out. ProtectedRoute calls it and
// only redirects when recovery genuinely fails.
// ---------------------------------------------------------------------------

/** Retry/backoff/timeout knobs. Exposed as a param on recoverSession so tests
 *  can run it instantly without real timers; production callers use defaults. */
interface RecoveryOptions {
  attempts: number;
  backoffMs: number;
  timeoutMs: number;
}
const RECOVERY_DEFAULTS: RecoveryOptions = { attempts: 3, backoffMs: 250, timeoutMs: 3000 };

/** Ceiling on the boot-time getSession so a hung SDK call can't strand the app
 *  on a spinner forever. On timeout we settle to "no user" and let recovery try. */
const BOOTSTRAP_TIMEOUT_MS = 8000;

/** Resolve to null if `p` doesn't settle within `ms`. Never rejects; a hung or
 *  throwing SDK call becomes "no result this attempt" rather than an exception. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True when the SDK has a session persisted to storage. Lets recovery skip
 *  pointless retries for a genuinely signed-out visitor (nothing to recover)
 *  while still retrying hard when a token IS present but the SDK momentarily
 *  returned null (the transient iOS/WebKit window). */
function hasPersistedSession(): boolean {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return !!raw && raw !== "null";
  } catch {
    // localStorage blocked (private mode / locked-down WebView): treat as no
    // persisted session so we don't spin on retries that can never read it.
    return false;
  }
}

/** Mirror a recovered session into the store. getSession does NOT emit an
 *  onAuthStateChange event, so we push it ourselves; refreshSession does emit
 *  one, but setting it here too is idempotent and closes the render gap. */
function adoptSession(session: Session): void {
  useAuth.setState({ session, user: session.user, loading: false });
}

/** Fire-and-forget Sentry signal so Ryan can watch the involuntary-logout rate
 *  drop after this ships. "recovered" = we saved a session that would otherwise
 *  have logged the rep out; "failed" = a rep with a persisted token still could
 *  not be recovered (the rare, high-signal case). Lazy import keeps Sentry out
 *  of the bundle when observability is disabled. */
function trackRecovery(outcome: "recovered" | "failed"): void {
  void import("@/lib/observability")
    .then(({ addBreadcrumb, captureMessage }) => {
      addBreadcrumb({
        category: "auth",
        level: outcome === "failed" ? "warning" : "info",
        message: `session.${outcome}`,
      });
      if (outcome === "failed") {
        captureMessage("Session recovery failed despite a persisted token", "warning");
      }
    })
    .catch(() => {
      /* observability is best-effort; never let it break auth */
    });
}

/**
 * Attempt to reconstitute a session before the app gives up and redirects to
 * /login. Returns true if a session was recovered (and mirrored into the store).
 *
 * Strategy:
 *   - No persisted token → at most ONE cheap read (covers a session that only
 *     exists in memory, e.g. just parsed from an OAuth callback), then give up
 *     fast so a genuinely signed-out visitor reaches /login without a stall.
 *   - Persisted token but the store shows none → the transient window: re-read,
 *     then force a refresh-token exchange, retrying a few times with a short
 *     backoff to ride it out.
 */
export async function recoverSession(
  opts: Partial<RecoveryOptions> = {},
): Promise<boolean> {
  const { attempts, backoffMs, timeoutMs } = { ...RECOVERY_DEFAULTS, ...opts };
  const persisted = hasPersistedSession();
  const maxAttempts = persisted ? attempts : 1;

  for (let i = 0; i < maxAttempts; i++) {
    const read = await withTimeout(supabase.auth.getSession(), timeoutMs);
    if (read?.data.session) {
      adoptSession(read.data.session);
      if (persisted) trackRecovery("recovered");
      return true;
    }
    if (persisted) {
      const refreshed = await withTimeout(supabase.auth.refreshSession(), timeoutMs);
      if (refreshed?.data.session) {
        adoptSession(refreshed.data.session);
        trackRecovery("recovered");
        return true;
      }
    }
    if (i < maxAttempts - 1) await delay(backoffMs);
  }

  // A persisted token that still couldn't produce a session is the genuine
  // involuntary-logout signal worth watching; a plain signed-out visitor
  // (no persisted token) is not, so it stays quiet.
  if (persisted) trackRecovery("failed");
  return false;
}

// ---------------------------------------------------------------------------
// Module-level side effects: hydrate from Supabase + subscribe to changes.
//
// Importing this module is what kicks off auth bootstrap. Runs exactly once
// per page load.
// ---------------------------------------------------------------------------

/** Push the signed-in user's id into Sentry (no PII beyond the auth id); null on
 *  sign-out so later errors aren't tagged with a stale user. Lazy import keeps
 *  Sentry out of the bundle when observability is disabled. */
function identifyUser(user: User | null): void {
  void import("@/lib/observability").then(({ setUser }) => {
    setUser(user ? { id: user.id } : null);
  });
}

if (typeof window !== "undefined") {
  // 1) Hydrate initial state from the SDK's persisted session. Guarded by a
  //    timeout so a hung getSession can't leave the app spinning forever: on
  //    timeout (or error) we settle to "no user" and let ProtectedRoute's
  //    recovery try to reconstitute the session.
  void (async () => {
    const result = await withTimeout(supabase.auth.getSession(), BOOTSTRAP_TIMEOUT_MS);
    if (result === null) {
      // getSession hung or threw. Don't strand the boot spinner; recovery
      // (triggered on the null user) will re-attempt with retry + refresh.
      useAuth.setState({ loading: false });
      return;
    }
    const { data, error } = result;
    if (error) {
      useAuth.setState({
        loading: false,
        error: errorMessage(error, "Failed to read session"),
      });
      return;
    }
    useAuth.setState({
      session: data.session,
      user: data.session?.user ?? null,
      loading: false,
    });
  })();

  // 2) Live-subscribe so other tabs / refresh events / sign-outs propagate.
  //    Event-aware on purpose: we only HARD-CLEAR the user on a genuine
  //    SIGNED_OUT. A momentary null session on any OTHER event (a WebKit
  //    resume blip, an INITIAL_SESSION race) must NOT wipe a user we already
  //    hold; that spurious clear is exactly what bounced mobile reps to
  //    /login. A truly dead/expired session still arrives as SIGNED_OUT (the
  //    SDK emits it when a refresh fails terminally), so we don't trap anyone
  //    in a broken authed state.
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      useAuth.setState({ session, user: session.user, loading: false });
      identifyUser(session.user);
      return;
    }
    if (event === "SIGNED_OUT") {
      useAuth.setState({ session: null, user: null, loading: false });
      identifyUser(null);
      return;
    }
    // Null session on a non-sign-out event. Release the loading gate but KEEP
    // whatever user we already hold (undefined stays untouched via the
    // functional update). On a cold start with genuinely no session we hold
    // no user, so this correctly settles to signed-out and ProtectedRoute's
    // recovery confirms there's nothing to recover before routing to /login.
    useAuth.setState((s) => ({ loading: false, user: s.user, session: s.session }));
  });
}

// ---------------------------------------------------------------------------
// Selectors / helpers
// ---------------------------------------------------------------------------

/** Read the current profession from user_metadata. */
export function getProfession(user: User | null): Profession | null {
  const raw = user?.user_metadata?.profession;
  if (raw === "payroll" || raw === "merchant_services" || raw === "treasury_management") {
    return raw;
  }
  return null;
}

/** Read the user's display name — falls back to email when fullName is missing. */
export function getFullName(user: User | null): string {
  const meta = user?.user_metadata as { full_name?: string } | undefined;
  return meta?.full_name?.trim() || user?.email || "there";
}

/** Read the user's first name (best-effort). Used in welcome copy.
 *
 *   Jane Doe              → "Jane"
 *   jane@navigatr.app     → "Jane"      (capitalize the local part)
 *   jane+work@gmail.com   → "Jane"      (strip + subaddressing tag)
 *   test+1778591756@…     → "Test"      (strip + tag; ignore numeric tail)
 *   (no name, no email)   → "there"     (from getFullName fallback)
 */
export function getFirstName(user: User | null): string {
  const full = getFullName(user);
  if (full.includes("@")) {
    // Email fallback: take local part, strip subaddressing tag, capitalize.
    const local = full.split("@")[0] ?? full;
    const cleaned = local.split("+")[0] ?? local;
    if (!cleaned) return full;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return full.split(/\s+/)[0] ?? full;
}

/**
 * Role union for the kickoff brief's RBAC scaffold. Not yet populated on
 * signup — defaults to undefined. Once role is wired (Session 4+ when
 * backend ships /api/me) the `getRole` helper returns the real value.
 */
export type Role =
  | "admin"
  | "cso"
  | "svp"
  | "vp"
  | "director"
  | "territory_manager"
  | "sales_professional";

const ROLE_VALUES: ReadonlyArray<Role> = [
  "admin", "cso", "svp", "vp", "director", "territory_manager", "sales_professional",
];

export function getRole(user: User | null): Role | null {
  const raw = user?.user_metadata?.role;
  if (typeof raw === "string" && (ROLE_VALUES as ReadonlyArray<string>).includes(raw)) {
    return raw as Role;
  }
  return null;
}

/** True when the user has a role above sales_professional (i.e. can invite). */
export function canInviteTeam(user: User | null): boolean {
  const role = getRole(user);
  // No role set yet = self-signup user = owner of their tenant = admin.
  // Once role is wired server-side this default goes away.
  if (role === null) return true;
  return role !== "sales_professional";
}

/** True once the user has dismissed the empty-state onboarding. */
export function hasDismissedOnboarding(user: User | null): boolean {
  const raw = user?.user_metadata?.onboarding_dismissed_at;
  return typeof raw === "string" && raw.length > 0;
}

/** Get the current access token (for ad-hoc API calls). */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
