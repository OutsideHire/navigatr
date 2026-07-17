import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

import { useDemoResetEnabled } from "./useDemoResetEnabled";

let maybeSingleResult: { data: { enabled: boolean } | null; error: Error | null };
const maybeSingleMock = vi.fn(() => Promise.resolve(maybeSingleResult));
const eqMock2 = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const eqMock1 = vi.fn(() => ({ eq: eqMock2 }));
const selectMock = vi.fn(() => ({ eq: eqMock1 }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "u-1" } }),
}));

vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "org-1" } }),
}));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  maybeSingleMock.mockClear();
  fromMock.mockClear();
});

describe("useDemoResetEnabled", () => {
  it("returns true when the org_features row has enabled: true", async () => {
    maybeSingleResult = { data: { enabled: true }, error: null };
    const { result } = renderHook(() => useDemoResetEnabled(), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current).toBe(true));
    expect(fromMock).toHaveBeenCalledWith("org_features");
  });

  it("returns false when there is no matching row", async () => {
    maybeSingleResult = { data: null, error: null };
    const { result } = renderHook(() => useDemoResetEnabled(), { wrapper: wrapper(client()) });
    await waitFor(() => expect(maybeSingleMock).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
