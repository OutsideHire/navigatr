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
