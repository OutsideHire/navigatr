/**
 * Visual catalog for the empty Dashboard.
 *
 * Wraps DashboardPage in AppLayout with a mock user, so we can visually
 * verify the empty state without needing a real Supabase session.
 *
 * Mounted at /component-preview/dashboard-empty (dev only).
 */

import { useEffect } from "react";
import { useAuth } from "@/stores/auth";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "./DashboardPage";
import type { User } from "@supabase/supabase-js";

const MOCK_USER = {
  id: "preview-mock",
  aud: "authenticated",
  role: "authenticated",
  email: "ryan@navigatr.app",
  user_metadata: {
    full_name: "Ryan Meo",
    profession: "merchant_services",
    // role intentionally omitted — exercises the canInviteTeam default
  },
  app_metadata: { provider: "preview" },
  created_at: new Date().toISOString(),
} as unknown as User;

const TOP_BAR_USER = {
  fullName: "Ryan Meo",
  email: "ryan@navigatr.app",
};

export function DashboardEmptyStories() {
  // Push the mock user into the auth store temporarily for this preview.
  // Restores the previous state on unmount.
  useEffect(() => {
    const prev = useAuth.getState();
    useAuth.setState({
      user: MOCK_USER,
      session: null,
      loading: false,
    });
    return () => {
      useAuth.setState({
        user: prev.user,
        session: prev.session,
        loading: prev.loading,
      });
    };
  }, []);

  return (
    <AppLayout user={TOP_BAR_USER}>
      <DashboardPage />
    </AppLayout>
  );
}

export default DashboardEmptyStories;
