import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { setUnauthorizedHandler } from "@/api";
import { useAuth, getProfession } from "@/stores/auth";

// Auth screens (no AppLayout)
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { SignUpPage } from "@/features/auth/pages/SignUpPage";
import { ForgotPasswordPage } from "@/features/auth/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/features/auth/pages/ResetPasswordPage";
import { InvitationAcceptancePage } from "@/features/auth/pages/InvitationAcceptancePage";
import { ProfessionSelectorPage } from "@/features/auth/pages/ProfessionSelectorPage";

// Protected screens (each wrapped in AppLayout by ProtectedRoute)
import { DashboardPage } from "@/features/dashboard/pages/DashboardPage";
import { PipelinePage } from "@/features/pipeline/pages/PipelinePage";
import { ActivitiesPage } from "@/features/activities/pages/ActivitiesPage";
import { PartnersPage } from "@/features/partners/pages/PartnersPage";
import { PathPage } from "@/features/path/pages/PathPage";
import { SettingsPage } from "@/features/settings/pages/SettingsPage";

// Component preview catalogs (dev / design review)
import { ButtonStories } from "@/components/navigatr/Button.stories";
import { FormFieldStories } from "@/components/navigatr/FormField.stories";
import { CardStories } from "@/components/navigatr/Card.stories";
import { AtomsStories } from "@/components/navigatr/Atoms.stories";
import { LayoutStories } from "@/components/navigatr/Layout.stories";
import { DashboardEmptyStories } from "@/features/dashboard/pages/DashboardEmptyStories";

/**
 * Wires the axios client's 401 handler to React Router's navigate so we
 * keep history clean and don't full-page-reload on token expiry.
 */
function AuthRouterBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      navigate("/login", { replace: true });
    });
  }, [navigate]);
  return null;
}

/**
 * Guards the public auth routes — if the user is already signed in *and* has
 * picked a profession, bounce them to /dashboard so /login isn't a dead end
 * for authed users.
 */
function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  if (loading) return null;
  if (user && getProfession(user)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthRouterBridge />
      <Routes>
        {/* ===== Public — sign in / sign up / recover ===== */}
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/signup"
          element={
            <PublicOnlyRoute>
              <SignUpPage />
            </PublicOnlyRoute>
          }
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invitation" element={<InvitationAcceptancePage />} />

        {/* ===== Authenticated but profession not yet set ===== */}
        <Route path="/select-profession" element={<ProfessionSelectorPage />} />

        {/* ===== Component preview (dev) — no auth, no AppLayout ===== */}
        <Route path="/component-preview/button" element={<ButtonStories />} />
        <Route path="/component-preview/form-fields" element={<FormFieldStories />} />
        <Route path="/component-preview/cards" element={<CardStories />} />
        <Route path="/component-preview/atoms" element={<AtomsStories />} />
        <Route path="/component-preview/layout" element={<LayoutStories />} />
        <Route path="/component-preview/dashboard-empty" element={<DashboardEmptyStories />} />

        {/* ===== Protected screens (each wrapped in AppLayout) ===== */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pipeline"
          element={
            <ProtectedRoute>
              <PipelinePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/activities"
          element={
            <ProtectedRoute>
              <ActivitiesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/partners"
          element={
            <ProtectedRoute>
              <PartnersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/path"
          element={
            <ProtectedRoute>
              <PathPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />

        {/* Root + 404 → /dashboard (ProtectedRoute will bounce to /login if needed) */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
