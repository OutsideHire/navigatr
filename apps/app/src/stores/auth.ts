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
  signInWithGoogle: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  setProfession: (profession: Profession) => Promise<void>;
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

  signInWithGoogle: async () => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signInWithMicrosoft: async () => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        scopes: "email openid profile",
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signUp: async (email, password, fullName) => {
    set({ error: null });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/select-profession`,
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

/** Get the current access token (for ad-hoc API calls). */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
