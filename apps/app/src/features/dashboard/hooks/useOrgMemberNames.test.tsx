import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useOrgMemberNames } from "./useOrgMemberNames";

const selectMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));
let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => { selectMock.mockReset(); authUserId = "user-1"; });

describe("useOrgMemberNames", () => {
  it("maps rows to id→name (full_name, email fallback)", async () => {
    selectMock.mockResolvedValueOnce({
      data: [
        { id: "u1", full_name: "Sarah Lim", email: "sarah@x.io" },
        { id: "u2", full_name: null, email: "nobody@x.io" },
      ],
      error: null,
    });
    const { result } = renderHook(() => useOrgMemberNames(), { wrapper });
    await waitFor(() => expect(result.current.get("u1")).toBe("Sarah Lim"));
    expect(result.current.get("u2")).toBe("nobody@x.io");
  });

  it("is empty and does not query when signed out", () => {
    authUserId = undefined;
    const { result } = renderHook(() => useOrgMemberNames(), { wrapper });
    expect(result.current.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("does not query when disabled (e.g. a rep who has no breakdown to show)", () => {
    const { result } = renderHook(() => useOrgMemberNames(false), { wrapper });
    expect(result.current.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });
});
