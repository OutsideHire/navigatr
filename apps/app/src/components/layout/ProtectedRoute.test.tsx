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
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: AuthShape) => unknown) => selector(authShape),
}));

// Mock useProfile so we can drive React Query states directly.
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => profileShape,
}));

// Mock the org-suspended status hook so we can drive the commercial hard block.
vi.mock("@/features/auth/useOrgSuspended", () => ({
  useOrgSuspended: () => suspendedShape,
}));

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

  it("redirects to /login when not authed", () => {
    authShape = { user: null, loading: false };
    renderAt("/dashboard");
    expect(screen.getByText("login page")).toBeInTheDocument();
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
