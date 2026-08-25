// Direct coverage for the commercial hard-block status hook. ProtectedRoute's
// tests mock this hook out, so its real query logic (enabled gating, the
// table/column/filter it reads, boolean coercion, error propagation) is only
// exercised here.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useOrgSuspended, ORG_SUSPENDED_QUERY_KEY } from "./useOrgSuspended";

const singleMock = vi.fn();
const eqMock = vi.fn(() => ({ single: singleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn((_table: string) => ({ select: selectMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: (table: string) => fromMock(table) },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

// Control org_id (which drives the query's `enabled`) via the useProfile mock.
let profileData: { org_id: string } | undefined;
vi.mock("./useProfile", () => ({
  useProfile: () => ({ data: profileData }),
}));

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  singleMock.mockReset();
  fromMock.mockClear();
  selectMock.mockClear();
  eqMock.mockClear();
  profileData = { org_id: "org-1" };
});

describe("useOrgSuspended", () => {
  it("does NOT fetch until the org_id is known", () => {
    profileData = undefined; // profile not yet resolved
    const { result } = renderHook(() => useOrgSuspended(), { wrapper: makeWrapper(newClient()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(singleMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("reads organizations.is_disabled for the caller's org and coerces to true", async () => {
    singleMock.mockResolvedValue({ data: { is_disabled: true }, error: null });
    const { result } = renderHook(() => useOrgSuspended(), { wrapper: makeWrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("organizations");
    expect(selectMock).toHaveBeenCalledWith("is_disabled");
    expect(eqMock).toHaveBeenCalledWith("id", "org-1");
  });

  it("coerces an active org (is_disabled false) to false", async () => {
    singleMock.mockResolvedValue({ data: { is_disabled: false }, error: null });
    const { result } = renderHook(() => useOrgSuspended(), { wrapper: makeWrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it("surfaces a Supabase error via isError (so ProtectedRoute can fail open)", async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useOrgSuspended(), { wrapper: makeWrapper(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("keys the query by user and org for clean invalidation", () => {
    expect(ORG_SUSPENDED_QUERY_KEY("u", "o")).toEqual(["org-suspended", "u", "o"]);
    expect(ORG_SUSPENDED_QUERY_KEY(undefined, undefined)).toEqual(["org-suspended", "anon", "none"]);
  });
});
