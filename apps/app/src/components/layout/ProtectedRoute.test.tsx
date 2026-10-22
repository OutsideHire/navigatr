// Regression: a profiles 500 (e.g. recursive RLS) used to manifest as an
// infinite redirect loop — ProtectedRoute saw `!profile.data`, bounced to
// /auth/callback, which re-queried, hit the same 500, and ProtectedRoute
// bounced again. The fix is the isError branch: render a terminal error
// instead of redirecting when the profile fetch fails.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { ProtectedRoute } from "./ProtectedRoute";

// Mock useAuth so we don't run the module-level Supabase bootstrap.
const { storeSignOut } = vi.hoisted(() => ({ storeSignOut: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: AuthShape & { signOut: typeof storeSignOut }) => unknown) =>
    selector({ ...authShape, signOut: storeSignOut }),
}));

// Mock useProfile so we can drive React Query states directly.
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => profileShape,
}));

// Mock the org-suspended status hook so we can drive the commercial hard block.
vi.mock("@/features/auth/useOrgSuspended", () => ({
  useOrgSuspended: () => suspendedShape,
}));

// Mock the session-recovery hook so we can drive its phase directly. Its own
// mechanics (retry + refresh) are covered in useSessionRecovery.test.tsx; here
// we only care how ProtectedRoute branches on the phase.
vi.mock("@/features/auth/useSessionRecovery", () => ({
  useSessionRecovery: () => recoveryPhase,
}));

// The background reconnect loop is covered in useReconnect.test.tsx; here we
// only check ProtectedRoute runs it exactly while the store is reconnecting.
const { useReconnect } = vi.hoisted(() => ({ useReconnect: vi.fn() }));
vi.mock("@/features/auth/useReconnect", () => ({ useReconnect }));

// AppLayout pulls in TopBar / SidebarNav / data-fetching hooks; stub it
// so this test stays focused on ProtectedRoute's branching.
vi.mock("./AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

// BrandProvider runs a query on mount; stub it out so this test doesn't
// need a QueryClientProvider. Tested separately in features/branding.
vi.mock("@/features/branding/BrandProvider", () => ({
  BrandProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

interface AuthShape {
  user: { id: string; email: string; user_metadata: Record<string, unknown> } | null;
  loading: boolean;
  reconnecting?: boolean;
}

let authShape: AuthShape;
let profileShape: {
  data: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
};
let suspendedShape: {
  data: boolean | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
};
let recoveryPhase: "recovering" | "reconnecting" | "settled";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>dashboard content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/auth/callback" element={<div>auth callback page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    authShape = {
      user: {
        id: "user-1",
        email: "u@example.com",
        user_metadata: { full_name: "U Example" },
      },
      loading: false,
    };
    profileShape = {
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    // Default: org is active (not suspended) and the status read is settled.
    suspendedShape = { data: false, isLoading: false, isFetching: false, isError: false };
    // Default: recovery has settled (no session to recover). Cases that exercise
    // the transient-null window override this to "recovering".
    recoveryPhase = "settled";
  });

  it("renders the error UI (not a redirect) when the profile fetch errors", () => {
    profileShape = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error("500: relation profiles policy recursion"),
    };

    renderAt("/dashboard");

    expect(screen.getByText(/could not load your profile/i)).toBeInTheDocument();
    expect(screen.getByText(/policy recursion/i)).toBeInTheDocument();
    // Critically: we did NOT bounce to /auth/callback. If we had, the loop
    // amplifier is back.
    expect(screen.queryByText("auth callback page")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard content")).not.toBeInTheDocument();
  });

  it("redirects to /auth/callback when there's no profile and no error", () => {
    profileShape = { data: null, isLoading: false, isFetching: false, isError: false, error: null };
    renderAt("/dashboard");
    expect(screen.getByText("auth callback page")).toBeInTheDocument();
  });

  it("redirects to /login when not authed and recovery has settled with no session", () => {
    authShape = { user: null, loading: false };
    recoveryPhase = "settled";
    renderAt("/dashboard");
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  it("holds the spinner (does NOT redirect) while a session is still recovering", () => {
    // The mobile-logout fix: a transient "no user" must not bounce a signed-in
    // rep to /login while recovery is still trying to reconstitute the session.
    authShape = { user: null, loading: false };
    recoveryPhase = "recovering";
    const { container } = renderAt("/dashboard");
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard content")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("holds a 'Reconnecting' wall instead of redirecting when the server was unreachable", () => {
    // The dead-zone case. Recovery failed because we never got an answer, NOT
    // because the session ended, so bouncing to /login hands a rep a form they
    // have no connection to submit and takes their day off the screen.
    authShape = { user: null, loading: false };
    recoveryPhase = "reconnecting";
    renderAt("/dashboard");
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
    // The escape hatch for a rep who really was signed out and won't wait.
    expect(screen.getByRole("link", { name: /sign in again/i })).toBeInTheDocument();
  });

  it("renders children inside AppLayout when authed with a profile", () => {
    profileShape = {
      data: { id: "user-1", org_id: "org-1", role: "manager", full_name: "U", created_at: "now" },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    renderAt("/dashboard");
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(screen.getByText("dashboard content")).toBeInTheDocument();
  });

  it("hard-blocks a suspended org with the access-paused wall (not the app)", () => {
    profileShape = {
      data: { id: "user-1", org_id: "org-1", role: "manager", full_name: "U", created_at: "now" },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    suspendedShape = { data: true, isLoading: false, isFetching: false, isError: false };
    renderAt("/dashboard");
    expect(screen.getByText(/access paused/i)).toBeInTheDocument();
    // The app shell and route content must NOT render for a suspended org.
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard content")).not.toBeInTheDocument();
  });

  it("holds the spinner on the FIRST org-suspended status load", () => {
    profileShape = {
      data: { id: "user-1", org_id: "org-1", role: "manager", full_name: "U", created_at: "now" },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    suspendedShape = { data: undefined, isLoading: true, isFetching: true, isError: false };
    const { container } = renderAt("/dashboard");
    // Neither the app nor the wall renders until the first status resolves.
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
    expect(screen.queryByText(/access paused/i)).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("does NOT spinner-flash on a background suspend-status refetch", () => {
    // Refocus refetch: cached status is known (active) but a fetch is in flight.
    // The app must keep rendering rather than flashing a full-screen spinner.
    profileShape = {
      data: { id: "user-1", org_id: "org-1", role: "manager", full_name: "U", created_at: "now" },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    suspendedShape = { data: false, isLoading: false, isFetching: true, isError: false };
    const { container } = renderAt("/dashboard");
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(screen.getByText("dashboard content")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("fails OPEN: renders the app when the suspend-status read errors", () => {
    profileShape = {
      data: { id: "user-1", org_id: "org-1", role: "manager", full_name: "U", created_at: "now" },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    };
    // Transient read failure -> data undefined; must not lock out a paying org.
    suspendedShape = { data: undefined, isLoading: false, isFetching: false, isError: true };
    renderAt("/dashboard");
    expect(screen.getByTestId("app-layout")).toBeInTheDocument();
    expect(screen.getByText("dashboard content")).toBeInTheDocument();
    expect(screen.queryByText(/access paused/i)).not.toBeInTheDocument();
  });

  it("shows a spinner while the profile is fetching", () => {
    profileShape = {
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    };
    const { container } = renderAt("/dashboard");
    // Spinner is a Loader2 icon — assert no redirect happened.
    expect(screen.queryByText("auth callback page")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard content")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});

/**
 * Held on the stored session while auth-js has not answered (TIMEOUT, online).
 * Production 2026-10: these reps were walled off and ended up on /login. They
 * must stay in the app with a small, non-blocking indicator instead.
 */
describe("ProtectedRoute while reconnecting", () => {
  beforeEach(() => {
    authShape = {
      user: { id: "user-1", email: "u@example.com", user_metadata: { full_name: "U Example" } },
      loading: false,
      reconnecting: true,
    };
    profileShape = { data: { id: "user-1" }, isLoading: false, isFetching: false, isError: false, error: null };
    suspendedShape = { data: false, isLoading: false, isFetching: false, isError: false };
    recoveryPhase = "settled";
    useReconnect.mockClear();
  });

  it("keeps the rep in the app with a non-blocking Reconnecting indicator", () => {
    renderAt("/dashboard");
    expect(screen.getByText("dashboard content")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting...");
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
  });

  it("runs the background reconnect loop only while reconnecting", () => {
    renderAt("/dashboard");
    expect(useReconnect).toHaveBeenLastCalledWith(true);
    authShape = { ...authShape, reconnecting: false };
    renderAt("/dashboard");
    expect(useReconnect).toHaveBeenLastCalledWith(false);
  });

  it("does not show the indicator once the session is confirmed", () => {
    authShape = { ...authShape, reconnecting: false };
    renderAt("/dashboard");
    expect(screen.queryByText("Reconnecting...")).not.toBeInTheDocument();
  });

  it("shows the indicator (not a bare spinner) while the profile waits on the token", () => {
    profileShape = { data: undefined, isLoading: true, isFetching: true, isError: false, error: null };
    renderAt("/dashboard");
    expect(screen.getByRole("status")).toHaveTextContent("Reconnecting...");
  });

  it("does not show the terminal profile error while still reconnecting", () => {
    // The profile read failed only because the token could not be confirmed
    // yet. Once it is, the failed read reloads; until then this is not final.
    profileShape = { data: undefined, isLoading: false, isFetching: false, isError: true, error: new Error("[42501] permission denied for table profiles") };
    renderAt("/dashboard");
    expect(screen.queryByText(/could not load your profile/i)).not.toBeInTheDocument();
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });
});

describe("ProtectedRoute reconnecting wall escape while held", () => {
  it("'Sign in again' signs out on this device and reaches the sign-in page", async () => {
    // A plain link to /login would bounce straight back: the public-only route
    // sees the held user and returns the rep to the app. Only dropping the
    // store's user (not the SDK's stored session) let a late answer from
    // auth-js sign the rep straight back in (M5), so this goes through the
    // store's signOut, which wipes the stored session locally while held.
    authShape = {
      user: { id: "user-1", email: "u@example.com", user_metadata: {} },
      loading: false,
      reconnecting: true,
    };
    profileShape = { data: undefined, isLoading: false, isFetching: false, isError: true, error: new Error("x") };
    suspendedShape = { data: false, isLoading: false, isFetching: false, isError: false };
    recoveryPhase = "settled";
    storeSignOut.mockClear();
    renderAt("/dashboard");
    screen.getByRole("button", { name: /sign in again/i }).click();
    expect(storeSignOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });
});
