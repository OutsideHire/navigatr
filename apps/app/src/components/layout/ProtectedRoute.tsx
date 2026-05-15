/**
 * Auth gate for any route that requires a signed-in user.
 *
 *   loading        → centered spinner (boot-time, before Supabase hydrates)
 *   no user        → redirect to /login (preserving the original location)
 *   no profession  → redirect to /select-profession
 *   otherwise      → wrap the children in AppLayout
 *
 * AppLayout used to be applied per-page; centralizing it here means every
 * protected screen automatically gets TopBar + nav + safe-area handling
 * without each page re-mounting the shell.
 */

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth, getProfession } from "@/stores/auth";
import { AppLayout } from "./AppLayout";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import type { TopBarUser } from "./TopBar";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!getProfession(user)) {
    return <Navigate to="/select-profession" replace />;
  }

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "—";
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;
  const topBarUser: TopBarUser = {
    fullName,
    email: user.email ?? undefined,
    avatarUrl,
  };

  // RouteErrorBoundary sits INSIDE AppLayout so a page crash collapses
  // only the main pane — TopBar + Sidebar + BottomNav keep working and
  // the user can navigate out. The boundary auto-resets on route change.
  return (
    <AppLayout user={topBarUser}>
      <RouteErrorBoundary>{children}</RouteErrorBoundary>
    </AppLayout>
  );
}
