/**
 * RequireRole — gate for role-protected routes. Sits inside ProtectedRoute,
 * so by the time it runs we know the user is authed; we only need to
 * check the profile.role against the allow-list.
 */
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useProfile } from "@/features/auth/useProfile";

export interface RequireRoleProps {
  allow: Array<"rep" | "manager" | "admin">;
  children: ReactNode;
}

export function RequireRole({ allow, children }: RequireRoleProps) {
  const profile = useProfile();

  if (profile.isLoading || profile.isFetching) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
      </div>
    );
  }

  if (!profile.data || !allow.includes(profile.data.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
