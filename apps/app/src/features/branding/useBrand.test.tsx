// useBrand: defaults when no row, mapping when row exists, error pass-through.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useBrand, DEFAULT_BRAND } from "./useBrand";

// Chainable supabase mock that resolves at .maybeSingle().
const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));

vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "org-1" } }),
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  fromMock.mockReset();
  fromMock.mockReturnValue({ select: selectMock });
  selectMock.mockClear();
  eqMock.mockClear();
  maybeSingleMock.mockReset();
});

describe("useBrand", () => {
  it("returns DEFAULT_BRAND when no org_branding row exists", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useBrand(), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DEFAULT_BRAND);
  });

  it("maps a row to Brand shape (snake_case → camelCase)", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        product_name: "Acme Sales",
        primary_color: "#2456e6",
        logo_url: "https://cdn.acme.example/logo.png",
        show_powered_by: false,
      },
      error: null,
    });
    const { result } = renderHook(() => useBrand(), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      productName: "Acme Sales",
      primaryColor: "#2456e6",
      logoUrl: "https://cdn.acme.example/logo.png",
      showPoweredBy: false,
    });
  });

  it("surfaces query errors", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    const { result } = renderHook(() => useBrand(), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("boom");
  });
});
