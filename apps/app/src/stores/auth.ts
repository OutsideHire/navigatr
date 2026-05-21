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
import { supabase } from "@/lib/supabase";

export type Profession = "payroll" | "merchant_services" | "treasury_management";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;

  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (inviteCode?: string) => Promise<void>;
  signInWithMicrosoft: (inviteCode?: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, inviteCode: string) => Promise<void>;
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
    const { error } = await supabase.auth.signUp({
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
// Module-level side effects: hydrate from Supabase + subscribe to changes.
//
// Importing this module is what kicks off auth bootstrap. Runs exactly once
// per page load.
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // 1) Hydrate initial state from the SDK's persisted session.
  supabase.auth
    .getSession()
    .then(({ data, error }) => {
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
    })
    .catch((err) => {
      useAuth.setState({
        loading: false,
        error: errorMessage(err, "Failed to read session"),
      });
    });

  // 2) Live-subscribe so other tabs / refresh events / sign-outs propagate.
  supabase.auth.onAuthStateChange((_event, session) => {
    useAuth.setState({
      session,
      user: session?.user ?? null,
      loading: false,
    });
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
