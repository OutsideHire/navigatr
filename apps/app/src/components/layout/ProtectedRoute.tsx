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

  return <AppLayout user={topBarUser}>{children}</AppLayout>;
}
