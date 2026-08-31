/**
 * /auth/callback — single owner of the post-OAuth and refresh-recovery flow.
 *
 * Runs on every OAuth completion (sign-in or sign-up — we can't tell at the
 * OAuth layer). Calls claim_invite_code() which is idempotent: existing
 * profile → no-op success; no profile → create one from the invite code
 * carried in the URL (?invite=) or sessionStorage fallback.
 *
 * Failure modes the user can hit here:
 *   - OAuth completed but Supabase didn't write a session yet (transient)
 *   - No invite code anywhere (user shared the OAuth-completion URL or
 *     refreshed without the original ?invite=)
 *   - Invalid / disabled invite code
 *
 * In all "stuck" cases we sign out so the user isn't trapped in an
 * authed-but-no-profile dead state.
 */

import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { resolveInviteCode } from "../lib/resolveInviteCode";
import { parseAuthCallbackError } from "../lib/authCallbackError";

export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loading = useAuth((s) => s.loading);
  const user = useAuth((s) => s.user);
  const [error, setError] = useState<string | null>(null);

  // An expired / invalid email link redirects here with the reason in the URL
  // hash (Supabase puts it there, not the query, so useSearchParams misses it).
  // Derive it SYNCHRONOUSLY so the render path can show a clear, actionable
  // message rather than the guard silently bouncing to /login before an async
  // effect could set it. Only for an unauthenticated visitor: a signed-in user
  // who clicks a stale link keeps their session (auth-js does not drop it on a
  // failed URL login) and proceeds to /dashboard via the effect below.
  const linkError = !loading && !user ? parseAuthCallbackError(window.location.hash, params) : null;

  useEffect(() => {
    // Wait for Supabase to hydrate the session from the URL hash / cookie.
    if (loading) return;

    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // No session: the sign-in did not complete. The render path below
        // decides what the user sees: a readable link error if the URL hash
        // carried one (expired / invalid email link), otherwise a bounce to
        // /login. Nothing to do here.
        return;
      }

      // Carriers, in precedence order: URL (?invite=), sessionStorage, then
      // user_metadata.invite_code. The metadata carrier is load-bearing when
      // email confirmation is ON: an invited rep confirming in a new tab or on
      // another device has no URL param and no sessionStorage, and only the
      // metadata (set at signUp) still carries the token. Without it the rep
      // would land on /create-organization and make their own org. Server-side
      // claim_invite_code still validates the code, so this grants nothing
      // beyond a genuine invite.
      const metaInvite = (session.user.user_metadata?.invite_code as string | undefined) ?? null;
      const { code, intentional: intentionallyHere } = resolveInviteCode({
        urlInvite: params.get("invite"),
        stashedInvite: sessionStorage.getItem("pending_invite"),
        metaInvite,
      });

      const { error: rpcError } = await supabase.rpc("claim_invite_code", { p_code: code });
      if (rpcError) {
        if (cancelled) return;
        const msg = rpcError.message ?? "";
        console.error("[claim_invite_code]", rpcError, "code was:", code, "intentional:", intentionallyHere);

        // No invite code? The user signed up to start a fresh workspace.
        // Route to /create-organization — they'll name the org, the RPC
        // will create the org + their manager profile, and we'll land at
        // /dashboard. Applies whether or not "intentionallyHere" is true:
        // a user with a session but no invite is unambiguously the
        // self-serve flow, not a stale-tab accident.
        if (msg.includes("invite_code_required")) {
          if (!cancelled) navigate("/create-organization", { replace: true });
          return;
        }

        // Set error FIRST. signOut() fires onAuthStateChange which clears
        // `user` synchronously via the store subscription; if we signOut
        // before setError, the re-render sees `!user && !error` and the
        // Navigate-to-/login branch fires, hiding the real error.
        setError(
          msg.includes("invalid_invite_code")
            ? "Your invite link is invalid or expired. Contact your account owner."
            : msg.includes("invite_code_required")
              ? "We could not find your invite code. Open the original invite link from your account owner."
              : `We could not finish signing you in: ${msg || "unknown error"}`
        );
        // Sign out so the user isn't stuck in an authed-but-no-profile state.
        // Fire-and-forget — error UI is already showing.
        void supabase.auth.signOut();
        return;
      }

      sessionStorage.removeItem("pending_invite");
      // Profile just appeared server-side. Eagerly refetch + cache it
      // BEFORE navigating, so ProtectedRoute on /dashboard sees real data
      // on its first render instead of a stale cached null from earlier
      // failed attempts. fetchQuery throws on error — wrap in try so we
      // still navigate even if the read is slow.
      try {
        await queryClient.fetchQuery({
          queryKey: ["profile", session.user.id],
          queryFn: async () => {
            const { data, error: pErr } = await supabase
              .from("profiles")
              .select("id, org_id, role, full_name, created_at")
              .eq("id", session.user.id)
              .maybeSingle();
            if (pErr) throw pErr;
            return data;
          },
        });
      } catch {
        // Non-fatal: ProtectedRoute will refetch. Worst case = a spinner.
      }
      if (!cancelled) navigate("/dashboard", { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, params, navigate, queryClient]);

  // If hydration finished and there's no session at all, the user landed here
  // without ever signing in. Bounce to /login, UNLESS the URL carried a
  // readable link error we should explain first (shown below).
  if (!loading && !user && !error && !linkError) {
    return <Navigate to="/login" replace />;
  }

  const shownError = error ?? linkError;
  if (shownError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-6">
        <div className="max-w-md text-center">
          <h1 className="text-heading-lg text-text-default">Sign-in failed</h1>
          <p className="mt-3 text-body-md text-text-muted">{shownError}</p>
          <button
            type="button"
            className="mt-6 inline-flex h-10 items-center rounded-md bg-brand-primary px-4 text-sm font-medium text-white"
            onClick={() => navigate("/login", { replace: true })}
          >
            Back to sign-in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
        <p className="text-body-md text-text-muted">Finishing sign-in…</p>
      </div>
    </div>
  );
}
