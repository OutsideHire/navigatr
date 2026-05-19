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

export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loading = useAuth((s) => s.loading);
  const user = useAuth((s) => s.user);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for Supabase to hydrate the session from the URL hash / cookie.
    if (loading) return;

    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setError("Sign-in did not complete. Try again.");
        return;
      }

      // Primary carrier: URL (?invite=). Fallback: sessionStorage.
      const code = params.get("invite") ?? sessionStorage.getItem("pending_invite") ?? "";

      const { error: rpcError } = await supabase.rpc("claim_invite_code", { p_code: code });
      if (rpcError) {
        // Set error FIRST. signOut() fires onAuthStateChange which clears
        // `user` synchronously via the store subscription; if we signOut
        // before setError, the re-render sees `!user && !error` and the
        // Navigate-to-/login branch fires, hiding the real error.
        if (cancelled) return;
        const msg = rpcError.message ?? "";
        console.error("[claim_invite_code]", rpcError, "code was:", code);
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

  // If hydration finished and there's no session at all, the user landed
  // here without ever signing in. Bounce to /login.
  if (!loading && !user && !error) {
    return <Navigate to="/login" replace />;
  }

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-6">
        <div className="max-w-md text-center">
          <h1 className="text-heading-lg text-text-default">Sign-in failed</h1>
          <p className="mt-3 text-body-md text-text-muted">{error}</p>
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
