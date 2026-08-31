/**
 * AuthCallbackPage wiring: the branch that decides what an arriving user sees.
 *
 * The pure message logic lives in authCallbackError.test.ts; this suite pins
 * the PAGE behavior that a unit test of the helper cannot:
 *   1. An already-signed-in user who clicks a STALE / expired email link must
 *      keep their session and proceed (auth-js does not drop a live session on
 *      a failed URL login). Regression guard for the review's Finding 1.
 *   2. An unauthenticated user who clicks an expired link sees the clear
 *      "link has expired" message, NOT a silent bounce to /login. The message
 *      is derived synchronously so the /login guard never wins the race.
 *   3. An unauthenticated user with no session and no link error bounces to
 *      /login (unchanged behavior).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mutable auth state the tests set before each render (the real store is a
// zustand hook; here we only need the settled values a render reads).
const { authState } = vi.hoisted(() => ({
  authState: { loading: false as boolean, user: null as unknown },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { loading: boolean; user: unknown }) => unknown) => selector(authState),
}));

// A readable profile row is the default (a normal, healthy sign-in). Individual
// tests override maybeSingle to simulate an unreadable / empty profile.
const READABLE_PROFILE = {
  id: "u1",
  org_id: "o1",
  role: "admin",
  full_name: "Test User",
  created_at: "2026-01-01T00:00:00Z",
};

vi.mock("@/lib/supabase", () => {
  const fromChain: Record<string, unknown> = {};
  fromChain.select = vi.fn(() => fromChain);
  fromChain.eq = vi.fn(() => fromChain);
  fromChain.maybeSingle = vi.fn(() => Promise.resolve({ data: READABLE_PROFILE, error: null }));
  return {
    supabase: {
      auth: {
        getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        signOut: vi.fn(() => Promise.resolve({ error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
      rpc: vi.fn(() => Promise.resolve({ error: null })),
      from: vi.fn(() => fromChain),
    },
  };
});

import { AuthCallbackPage } from "./AuthCallbackPage";
import { supabase } from "@/lib/supabase";

// supabase.from() always returns the same mock chain object; grab it so tests
// can steer the profile read (data: row -> proceed; data: null -> stop).
const profileChain = (supabase.from as unknown as (t: string) => { maybeSingle: ReturnType<typeof vi.fn> })(
  "profiles",
);

const EXPIRED_HASH =
  "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

/** A live session for a signed-in user id. */
function sessionFor(id: string) {
  return { data: { session: { user: { id, user_metadata: {} } } }, error: null } as never;
}

function renderCallback(hash: string, client?: QueryClient) {
  window.location.hash = hash;
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/login" element={<div>LOGIN SENTINEL</div>} />
          <Route path="/dashboard" element={<div>DASHBOARD SENTINEL</div>} />
          <Route path="/create-organization" element={<div>CREATE ORG SENTINEL</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AuthCallbackPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.loading = false;
    authState.user = null;
    // Default: no session (each test overrides as needed).
    vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null }, error: null } as never);
    vi.mocked(supabase.rpc).mockResolvedValue({ error: null } as never);
    // Default: profile reads back a real row (a healthy sign-in). clearAllMocks
    // wiped the factory default's call state, so re-assert the implementation.
    profileChain.maybeSingle.mockResolvedValue({ data: READABLE_PROFILE, error: null } as never);
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("lets an already-signed-in user through despite a stale expired-link hash (Finding 1)", async () => {
    // A live session in the store AND from getSession: the user is signed in and
    // just happened to click an old link still in their inbox.
    authState.user = { id: "u1", user_metadata: {} };
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: "u1", user_metadata: {} } } },
      error: null,
    } as never);

    renderCallback(EXPIRED_HASH);

    // Proceeds to the app; never shows the "expired" error screen.
    expect(await screen.findByText("DASHBOARD SENTINEL")).toBeInTheDocument();
    expect(screen.queryByText(/expired or is no longer valid/i)).not.toBeInTheDocument();
    expect(screen.queryByText("LOGIN SENTINEL")).not.toBeInTheDocument();
  });

  it("stops with a clear message when the profile stays unreadable after claim (no /dashboard bounce loop)", async () => {
    // Regression guard for NAVIGATR-APP-A: a signed-in user whose profile row
    // reads back null even after claim_invite_code succeeds. Navigating to
    // /dashboard would bounce right back here (ProtectedRoute redirects a
    // null-profile user to /auth/callback), hammering history.replaceState until
    // the browser throws a SecurityError. The callback must stop instead.
    authState.user = { id: "u1", user_metadata: {} };
    vi.mocked(supabase.auth.getSession).mockResolvedValue(sessionFor("u1"));
    vi.mocked(supabase.rpc).mockResolvedValue({ error: null } as never); // claim succeeds
    profileChain.maybeSingle.mockResolvedValue({ data: null, error: null } as never); // but profile unreadable

    renderCallback("");

    expect(await screen.findByText(/could not load your profile/i)).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD SENTINEL")).not.toBeInTheDocument();
    // Signs out so the user is not stuck authed-but-no-profile and "Back to
    // sign-in" can actually reach /login.
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it("reads the profile LIVE even when a stale null is cached, so a just-provisioned user is not dead-ended", async () => {
    // Finding 1 guard: ProtectedRoute caches a null under ["profile", uid] right
    // before redirecting here. With the app's global 30s staleTime, fetchQuery
    // would serve that cached null WITHOUT re-querying -- falsely dead-ending a
    // user whose profile the claim just created. The callback must force a live
    // read (staleTime: 0).
    authState.user = { id: "u1", user_metadata: {} };
    vi.mocked(supabase.auth.getSession).mockResolvedValue(sessionFor("u1"));
    profileChain.maybeSingle.mockResolvedValue({ data: READABLE_PROFILE, error: null } as never); // DB has the row now
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    client.setQueryData(["profile", "u1"], null); // stale null already cached, < 30s old

    renderCallback("", client);

    expect(await screen.findByText("DASHBOARD SENTINEL")).toBeInTheDocument();
    expect(screen.queryByText(/could not load your profile/i)).not.toBeInTheDocument();
  });

  it("proceeds to /dashboard when the profile reads back after a successful claim", async () => {
    authState.user = { id: "u1", user_metadata: {} };
    vi.mocked(supabase.auth.getSession).mockResolvedValue(sessionFor("u1"));
    // profileChain default returns READABLE_PROFILE (set in beforeEach).

    renderCallback("");

    expect(await screen.findByText("DASHBOARD SENTINEL")).toBeInTheDocument();
    expect(screen.queryByText(/could not load your profile/i)).not.toBeInTheDocument();
  });

  it("shows a clear expired-link message to an unauthenticated visitor (not a silent /login bounce)", async () => {
    authState.user = null;

    renderCallback(EXPIRED_HASH);

    expect(await screen.findByText(/expired or is no longer valid/i)).toBeInTheDocument();
    expect(screen.getByText("Sign-in failed")).toBeInTheDocument();
    expect(screen.queryByText("LOGIN SENTINEL")).not.toBeInTheDocument();
  });

  it("surfaces a non-expiry provider error rather than bouncing", async () => {
    authState.user = null;

    renderCallback("#error=server_error&error_description=Something+went+wrong");

    expect(await screen.findByText("We could not sign you in: Something went wrong")).toBeInTheDocument();
  });

  it("bounces to /login when there is no session and no link error", async () => {
    authState.user = null;

    renderCallback("");

    expect(await screen.findByText("LOGIN SENTINEL")).toBeInTheDocument();
  });
});
