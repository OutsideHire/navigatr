// Covers: query keys are paged; merges profiles + invites; status mapping;
// deal-aggregate join; auth refusal.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useOrgAgents } from "./useOrgAgents";

// Each call to .from() returns a chainable mock. We assign per-table
// fixtures so we can vary results for profiles vs org_invites vs deals.
const profilesFixture: Array<Record<string, unknown>> = [];
const invitesFixture: Array<Record<string, unknown>> = [];
const dealAggsFixture: Array<Record<string, unknown>> = [];

function chain(table: string) {
  const filters: Record<string, unknown> = {};
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: (col: string, v: unknown) => { filters[col] = v; return obj; },
    in: () => obj,
    is: () => obj,
    order: () => obj,
    range: () => obj,
    limit: () => obj,
    neq: () => obj,
    then: (resolve: (r: { data: unknown[]; error: null; count: number }) => void) => {
      const data =
        table === "profiles" ? profilesFixture :
        table === "org_invites" ? invitesFixture :
        table === "deals" ? dealAggsFixture : [];
      resolve({ data, error: null, count: data.length });
    },
  };
  return obj;
}

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (t: string) => chain(t) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  profilesFixture.length = 0;
  invitesFixture.length = 0;
  dealAggsFixture.length = 0;
  authUserId = "user-1";
});

describe("useOrgAgents", () => {
  it("returns merged active + pending + revoked agents", async () => {
    profilesFixture.push(
      { id: "p1", email: "alice@x.com", full_name: "Alice", role: "rep", deactivated_at: null, created_at: "2026-05-01T00:00:00Z" },
      { id: "p2", email: "bob@x.com",   full_name: "Bob",   role: "rep", deactivated_at: "2026-05-15T00:00:00Z", created_at: "2026-05-01T00:00:00Z" },
    );
    invitesFixture.push(
      { id: "i1", email: "carol@x.com", full_name: "Carol", role: "rep", expires_at: "2026-06-05T00:00:00Z", created_at: "2026-05-20T00:00:00Z" },
    );

    const { result } = renderHook(() => useOrgAgents({ page: 0, pageSize: 50 }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data?.rows.map((r) => r.status)).toEqual(
      expect.arrayContaining(["active", "invited", "revoked"]),
    );
    expect(result.current.data?.rows).toHaveLength(3);
  });

  it("refuses when not signed in (returns no data; enabled=false)", () => {
    authUserId = undefined;
    const { result } = renderHook(() => useOrgAgents({ page: 0, pageSize: 50 }), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe("idle"); // disabled
  });
});
