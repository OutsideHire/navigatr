// Verifies the snake → camel mapping and the disabled-when-no-profile
// behavior. The actual share UI is tested via the SettingsPage path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useOrganization, ORGANIZATION_QUERY_KEY } from "./useOrganization";

const singleMock = vi.fn();
const eqMock = vi.fn(() => ({ single: singleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));

let authUserId: string | undefined;
let profileOrgId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));
vi.mock("./useProfile", () => ({
  useProfile: () => ({ data: profileOrgId ? { org_id: profileOrgId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  singleMock.mockReset();
  eqMock.mockClear();
  selectMock.mockClear();
  authUserId = "user-1";
  profileOrgId = "org-1";
});

describe("useOrganization", () => {
  it("maps invite_code → inviteCode and returns the org row", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "org-1", name: "Outside Hire", invite_code: "NAV-LAUNCH-001" },
      error: null,
    });
    const { result } = renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      id: "org-1",
      name: "Outside Hire",
      inviteCode: "NAV-LAUNCH-001",
    });
  });

  it("filters by the user's profile org_id", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "org-1", name: "X", invite_code: "X" },
      error: null,
    });
    renderHook(() => useOrganization(), { wrapper });
    await waitFor(() => expect(eqMock).toHaveBeenCalled());
    expect(eqMock).toHaveBeenCalledWith("id", "org-1");
  });

  it("disabled when profile hasn't loaded yet (no org_id)", () => {
    profileOrgId = undefined;
    const { result } = renderHook(() => useOrganization(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("disabled when not signed in", () => {
    authUserId = undefined;
    const { result } = renderHook(() => useOrganization(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("cache key shape pins userId + orgId for clean sign-out invalidation", () => {
    expect(ORGANIZATION_QUERY_KEY("u-1", "org-1")).toEqual(["organization", "u-1", "org-1"]);
    expect(ORGANIZATION_QUERY_KEY(undefined, undefined)).toEqual(["organization", "anon", "none"]);
  });
});
