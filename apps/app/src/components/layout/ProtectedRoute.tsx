/**
 * Auth gate for any route that requires a signed-in user.
 *
 *   loading            → centered spinner (boot-time, before Supabase hydrates)
 *   no user            → redirect to /login (preserving the original location)
 *   profile fetching   → spinner
 *   no profile         → redirect to /auth/callback (idempotent claim_invite_code)
 *   otherwise          → wrap the children in AppLayout
 *
 * AppLayout used to be applied per-page; centralizing it here means every
 * protected screen automatically gets TopBar + nav + safe-area handling
 * without each page re-mounting the shell.
 *
 * The /select-profession step is intentionally bypassed during Sprint 1
 * backend rollout — the design doc's profiles schema has no profession
 * field. Re-introduce later if the post-signup wizard returns.
 */

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/stores/auth";
import { useProfile } from "@/features/auth/useProfile";
import { useOrgSuspended } from "@/features/auth/useOrgSuspended";
import { AppLayout } from "./AppLayout";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { BrandProvider } from "@/features/branding/BrandProvider";
import type { TopBarUser } from "./TopBar";

function Spinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas">
      <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
    </div>
  );
}

/**
 * Terminal wall shown when the caller's org has been suspended
 * (organizations.is_disabled). Every authenticated route renders this instead
 * of its content, so a suspended org is fully locked out. A Sign out affordance
 * lets the user leave (or switch accounts); we do NOT auto-sign-out, which would
 * bounce to /login and hide this explanation.
 */
function OrgSuspendedWall() {
  const signOut = useAuth((s) => s.signOut);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-6">
      <div className="max-w-md text-center">
        <h1 className="text-heading-lg text-text-default">Access paused</h1>
        <p className="mt-3 text-body-md text-text-muted">
          Your organization's navigatr access has been paused. Please contact your
          Navigatr account manager to restore it.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-6 text-body-sm font-medium text-text-default underline underline-offset-2 hover:text-text-muted"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  const profile = useProfile();
  const suspended = useOrgSuspended();
  const location = useLocation();

  if (loading) return <Spinner />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Hold the spinner while ANY profile fetch is in flight, including a
  // background refetch over stale cached null (which is exactly what
  // happens right after a successful claim_invite_code: the previous
  // failed attempt cached data=null, the successful attempt invalidates
  // it, but the new fetch is still in flight on the first render). Without
  // this, ProtectedRoute reads the stale null and bounces to /auth/callback,
  // which idempotent-succeeds and bounces back — infinite loop.
  if (profile.isLoading || profile.isFetching) return <Spinner />;

  // If the profile fetch errored, do NOT redirect — /auth/callback would
  // re-query and hit the same error, producing a redirect loop that
  // hammers the server. Show a terminal error instead. This was the
  // amplifier behind the profiles RLS recursion 500-storm: a server bug
  // became a runtime retry loop.
  if (profile.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-canvas px-6">
        <div className="max-w-md text-center">
          <h1 className="text-heading-lg text-text-default">Could not load your profile</h1>
          <p className="mt-3 text-body-md text-text-muted">
            {profile.error instanceof Error ? profile.error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  if (!profile.data) {
    // Authed but no `profiles` row. Could be: mid-OAuth handoff, refresh
    // during callback, or an existing legacy account from before the
    // backend launch. /auth/callback handles all three because the RPC
    // is idempotent — it'll either create the profile or sign the user
    // out with a clear error.
    const stashed = typeof window !== "undefined" ? sessionStorage.getItem("pending_invite") : null;
    const target = stashed ? `/auth/callback?invite=${encodeURIComponent(stashed)}` : "/auth/callback";
    return <Navigate to={target} replace />;
  }

  // Commercial hard block. A suspended org (organizations.is_disabled = true,
  // set by the Navigatr operator) locks its users out of every authed surface.
  // The value is server-authoritative (organizations_select RLS exposes only
  // the caller's own org row). Hold the spinner only on the FIRST load (no
  // cached status yet) so the app never flashes before the initial check; do
  // NOT gate on background refetches (isFetching), or every window refocus would
  // flash a full-screen spinner over a working app. A fresh suspend still takes
  // effect on the next render once the refetch resolves. Fail OPEN on a
  // transient read error: a network blip must not lock out a paying org, so ONLY
  // an explicit is_disabled === true blocks.
  if (suspended.isLoading) return <Spinner />;
  if (suspended.data === true) return <OrgSuspendedWall />;

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "—";
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;
  const topBarUser: TopBarUser = {
    fullName,
    email: user.email ?? undefined,
    avatarUrl,
  };

  // BrandProvider sits ABOVE AppLayout so the white-label theme (custom
  // primary color, product name in document.title) applies to every
  // protected surface — TopBar, sidebar, content, modals.
  // RouteErrorBoundary sits INSIDE AppLayout so a page crash collapses
  // only the main pane — TopBar + Sidebar + BottomNav keep working and
  // the user can navigate out. The boundary auto-resets on route change.
  return (
    <BrandProvider>
      <AppLayout user={topBarUser}>
        <RouteErrorBoundary>{children}</RouteErrorBoundary>
      </AppLayout>
    </BrandProvider>
  );
}
