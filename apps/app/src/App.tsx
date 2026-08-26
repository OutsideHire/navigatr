import { lazy, Suspense, useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { RouteErrorBoundary } from "@/components/layout/RouteErrorBoundary";
import { RequireRole } from "@/components/layout/RequireRole";
import { setUnauthorizedHandler } from "@/api";
import { CookieBanner } from "@/features/legal/CookieBanner";
import { useAuth } from "@/stores/auth";

/**
 * Route components are lazy-loaded so the initial JS bundle only ships
 * what the login page needs. Hitting /dashboard fetches the dashboard
 * chunk on demand; hitting /pipeline fetches the pipeline chunk; etc.
 *
 * Effect on the entry bundle: 1.03 MB → ~150-200 KB. The remaining
 * ~800 KB is split across route chunks + vendor chunks (Radix, TanStack,
 * Supabase, libphonenumber, lucide, react-hook-form+zod, date-fns)
 * configured via manualChunks in vite.config.ts.
 *
 * Auth pages stay roughly co-located in the auth chunk so that signup/
 * forgot-password don't each fetch a separate chunk on first visit.
 */

// Auth screens (no AppLayout)
const LoginPage = lazy(() =>
  import("@/features/auth/pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const SignUpPage = lazy(() =>
  import("@/features/auth/pages/SignUpPage").then((m) => ({ default: m.SignUpPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("@/features/auth/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import("@/features/auth/pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })),
);
const ProfessionSelectorPage = lazy(() =>
  import("@/features/auth/pages/ProfessionSelectorPage").then((m) => ({ default: m.ProfessionSelectorPage })),
);
const AuthCallbackPage = lazy(() =>
  import("@/features/auth/pages/AuthCallbackPage").then((m) => ({ default: m.AuthCallbackPage })),
);
const CreateOrganizationPage = lazy(() =>
  import("@/features/auth/pages/CreateOrganizationPage").then((m) => ({ default: m.CreateOrganizationPage })),
);
const WelcomeInvitePage = lazy(() =>
  import("@/features/auth/pages/WelcomeInvitePage").then((m) => ({ default: m.WelcomeInvitePage })),
);

// Protected screens (each wrapped in AppLayout by ProtectedRoute)
const DashboardPage = lazy(() =>
  import("@/features/dashboard/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const ActivityToWinReport = lazy(() =>
  import("@/features/dashboard/pages/ActivityToWinReport").then((m) => ({ default: m.ActivityToWinReport })),
);
const PersistenceIndexReport = lazy(() =>
  import("@/features/dashboard/pages/PersistenceIndexReport").then((m) => ({ default: m.PersistenceIndexReport })),
);
const LeadSourceReport = lazy(() =>
  import("@/features/dashboard/pages/LeadSourceReport").then((m) => ({ default: m.LeadSourceReport })),
);
const PipelinePage = lazy(() =>
  import("@/features/pipeline/pages/PipelinePage").then((m) => ({ default: m.PipelinePage })),
);
const DealDetailPage = lazy(() =>
  import("@/features/pipeline/pages/DealDetailPage").then((m) => ({ default: m.DealDetailPage })),
);
const ActivitiesPage = lazy(() =>
  import("@/features/activities/pages/ActivitiesPage").then((m) => ({ default: m.ActivitiesPage })),
);
const PartnersPage = lazy(() =>
  import("@/features/partners/pages/PartnersPage").then((m) => ({ default: m.PartnersPage })),
);
const PartnerDetailPage = lazy(() =>
  import("@/features/partners/pages/PartnerDetailPage").then((m) => ({ default: m.PartnerDetailPage })),
);
const PathPage = lazy(() =>
  import("@/features/path/pages/PathPage").then((m) => ({ default: m.PathPage })),
);
const SettingsHubPage = lazy(() =>
  import("@/features/settings-hub/SettingsHubPage").then((m) => ({ default: m.SettingsHubPage })),
);

// Admin screens (role-gated: manager + admin only)
const AgentsPage = lazy(() =>
  import("@/features/admin/pages/AgentsPage").then((m) => ({ default: m.AgentsPage })),
);
const ImportAgentsPage = lazy(() =>
  import("@/features/admin/pages/ImportAgentsPage").then((m) => ({ default: m.ImportAgentsPage })),
);
// AdminSettingsPage dissolved into the SettingsHubPage tabs. The
// /admin/settings route now redirects to /settings?tab=organization.
const InsightsPage = lazy(() =>
  import("@/features/admin/pages/InsightsPage").then((m) => ({ default: m.InsightsPage })),
);
const AgentDetailPage = lazy(() =>
  import("@/features/admin/pages/AgentDetailPage").then((m) => ({ default: m.AgentDetailPage })),
);

// Accept-invite (public — no AppLayout, no auth required)
const AcceptInvitePage = lazy(() =>
  import("@/features/auth/pages/AcceptInvitePage").then((m) => ({ default: m.AcceptInvitePage })),
);

// Legal pages (public — must be reachable without auth for vendor
// security review + contract review). Lazy-loaded since most users
// never visit them.
const TermsPage = lazy(() =>
  import("@/features/legal/pages/TermsPage").then((m) => ({ default: m.TermsPage })),
);
const PrivacyPage = lazy(() =>
  import("@/features/legal/pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);

// Component preview catalogs (dev / design review). Lazy-loaded for
// the same reason — they're large story files that nobody reaches in
// normal use, no reason to inflate the prod bundle.
const ButtonStories = lazy(() =>
  import("@/components/navigatr/Button.stories").then((m) => ({ default: m.ButtonStories })),
);
const FormFieldStories = lazy(() =>
  import("@/components/navigatr/FormField.stories").then((m) => ({ default: m.FormFieldStories })),
);
const CardStories = lazy(() =>
  import("@/components/navigatr/Card.stories").then((m) => ({ default: m.CardStories })),
);
const AtomsStories = lazy(() =>
  import("@/components/navigatr/Atoms.stories").then((m) => ({ default: m.AtomsStories })),
);
const LayoutStories = lazy(() =>
  import("@/components/navigatr/Layout.stories").then((m) => ({ default: m.LayoutStories })),
);
const DashboardEmptyStories = lazy(() =>
  import("@/features/dashboard/pages/DashboardEmptyStories").then((m) => ({ default: m.DashboardEmptyStories })),
);

/**
 * Shared Suspense fallback. Centered spinner on a full-viewport canvas
 * so the screen doesn't flash blank during chunk fetch. Matches the
 * ProtectedRoute loading state for visual continuity.
 */
function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-canvas">
      <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading…" />
    </div>
  );
}

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
 * Guards the public auth routes — if the user is already signed in, bounce
 * them to /dashboard so /login isn't a dead end for authed users. The
 * ProtectedRoute on /dashboard then handles the no-profile-yet case by
 * routing through /auth/callback (idempotent claim).
 */
function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);
  if (loading) return null;
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthRouterBridge />
      {/* Top-level safety net: catches render crashes on the PRE-AUTH routes
          (login/signup/callback/create-org) and lazy chunk-load failures that
          the inner AppLayout boundary (authed routes only) never sees. Without
          it, such a crash blanks the whole #root (ISSUE-001 class). */}
      <RouteErrorBoundary>
      {/* Single Suspense boundary at the route layer — keeps the spinner
          centered on viewport regardless of which page is loading. Per-
          route boundaries would let us scope fallbacks to the main pane,
          but for sprint 1 the simpler full-viewport spinner is fine. */}
      <Suspense fallback={<RouteFallback />}>
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
          <Route path="/accept-invite" element={<AcceptInvitePage />} />

          {/* Legal — public, no auth, no AppLayout */}
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />

          {/* ===== OAuth + email-confirm landing ===== */}
          {/* Owns the post-signup claim_invite_code flow. Never gated by
              PublicOnlyRoute — the user IS authed here, and the page itself
              decides where to send them next. */}
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          {/* Self-serve org bootstrap. Authed users w/o a profile land here. */}
          <Route path="/create-organization" element={<CreateOrganizationPage />} />
          <Route path="/welcome" element={<WelcomeInvitePage />} />

          {/* ===== Authenticated but profession not yet set ===== */}
          {/* Kept reachable (deep links from old emails) but no longer
              part of the signup flow. ProtectedRoute now gates on profile,
              not profession. */}
          <Route path="/select-profession" element={<ProfessionSelectorPage />} />

          {/* ===== Component preview — DEV builds only ===== */}
          {/* Internal component galleries. Gated to dev so they are never
              registered in the production bundle; in prod these URLs fall
              through to the catch-all redirect. No auth, no AppLayout. */}
          {import.meta.env.DEV && (
            <>
              <Route path="/component-preview/button" element={<ButtonStories />} />
              <Route path="/component-preview/form-fields" element={<FormFieldStories />} />
              <Route path="/component-preview/cards" element={<CardStories />} />
              <Route path="/component-preview/atoms" element={<AtomsStories />} />
              <Route path="/component-preview/layout" element={<LayoutStories />} />
              <Route path="/component-preview/dashboard-empty" element={<DashboardEmptyStories />} />
            </>
          )}

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
            path="/dashboard/activity-to-win"
            element={
              <ProtectedRoute>
                <ActivityToWinReport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/persistence-index"
            element={
              <ProtectedRoute>
                <PersistenceIndexReport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/lead-source"
            element={
              <ProtectedRoute>
                <LeadSourceReport />
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
            path="/pipeline/:dealId"
            element={
              <ProtectedRoute>
                <DealDetailPage />
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
            path="/partners/:partnerId"
            element={
              <ProtectedRoute>
                <PartnerDetailPage />
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
          {/* Settings hub: one component, two URL shapes.
              Desktop: /settings?tab=<id>
              Mobile:  /settings/<id>
              Both render <SettingsHubPage/>; the component switches layout
              based on viewport. */}
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsHubPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/:tabId"
            element={
              <ProtectedRoute>
                <SettingsHubPage />
              </ProtectedRoute>
            }
          />

          {/* ===== Admin screens (manager + admin only) ===== */}
          <Route
            path="/admin/agents/:id"
            element={
              <ProtectedRoute>
                <RequireRole allow={["manager", "admin"]}>
                  <AgentDetailPage />
                </RequireRole>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={<Navigate to="/admin/agents" replace />}
          />
          <Route
            path="/admin/agents"
            element={
              <ProtectedRoute>
                <RequireRole allow={["manager", "admin"]}>
                  <AgentsPage />
                </RequireRole>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/agents/import"
            element={
              <ProtectedRoute>
                <RequireRole allow={["manager", "admin"]}>
                  <ImportAgentsPage />
                </RequireRole>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/insights"
            element={
              <ProtectedRoute>
                <RequireRole allow={["manager", "admin"]}>
                  <InsightsPage />
                </RequireRole>
              </ProtectedRoute>
            }
          />

          {/* Back-compat redirect: old /admin/settings bookmarks land on the
              Organization tab of the new hub. Anyone hitting this path is
              implicitly an admin user (they bookmarked it), so the
              destination tab is admin-relevant. */}
          <Route
            path="/admin/settings"
            element={<Navigate to="/settings?tab=organization" replace />}
          />

          {/* Root + 404 → /dashboard (ProtectedRoute will bounce to /login if needed) */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
      </RouteErrorBoundary>

      {/* Cookie banner — sits inside <BrowserRouter> because it links to
          /privacy via <Link>. Self-hides once the user records a consent
          decision; re-shows if the consent schema version bumps. */}
      <CookieBanner />
    </BrowserRouter>
  );
}
