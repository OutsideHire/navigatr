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

import { LoginPage } from "@/features/auth/pages/LoginPage";
import { SignUpPage } from "@/features/auth/pages/SignUpPage";
import { ForgotPasswordPage } from "@/features/auth/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/features/auth/pages/ResetPasswordPage";
import { InvitationAcceptancePage } from "@/features/auth/pages/InvitationAcceptancePage";
import { ProfessionSelectorPage } from "@/features/auth/pages/ProfessionSelectorPage";
import { DashboardPage } from "@/features/dashboard/pages/DashboardPage";
import { ButtonStories } from "@/components/navigatr/Button.stories";
import { FormFieldStories } from "@/components/navigatr/FormField.stories";
import { CardStories } from "@/components/navigatr/Card.stories";
import { AtomsStories } from "@/components/navigatr/Atoms.stories";

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
        {/* Public — sign in / sign up / recover */}
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

        {/* Visual catalog for design-system components — always routed so
            prod previews work too. ButtonStories is small enough to ship. */}
        <Route path="/component-preview/button" element={<ButtonStories />} />
        <Route path="/component-preview/form-fields" element={<FormFieldStories />} />
        <Route path="/component-preview/cards" element={<CardStories />} />
        <Route path="/component-preview/atoms" element={<AtomsStories />} />

        {/* Authenticated, but profession not yet set */}
        <Route path="/select-profession" element={<ProfessionSelectorPage />} />

        {/* Protected */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
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
