import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useActivityGeostampSetting,
  useUpdateActivityGeostampSetting,
} from "./useActivityGeostampSetting";

let settingsRow: { activity_geostamp_enabled: boolean } | null = null;
const upsertMock = vi.fn(
  (_row: Record<string, unknown>, _opts: unknown) => Promise.resolve({ error: null }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: settingsRow, error: null }) }),
      }),
      upsert: (row: Record<string, unknown>, opts: unknown) => upsertMock(row, opts),
    }),
  },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "u1" } }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "o1" } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  settingsRow = null;
  upsertMock.mockClear();
});

describe("useActivityGeostampSetting", () => {
  it("defaults to enabled (true) when no row exists", async () => {
    const { result } = renderHook(() => useActivityGeostampSetting(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
  });

  it("reflects an explicit opt-out", async () => {
    settingsRow = { activity_geostamp_enabled: false };
    const { result } = renderHook(() => useActivityGeostampSetting(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });
});

describe("useUpdateActivityGeostampSetting", () => {
  it("upserts the user's row on user_id with the chosen value", async () => {
    const { result } = renderHook(() => useUpdateActivityGeostampSetting(), { wrapper });
    await result.current.mutateAsync(false);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [row, opts] = upsertMock.mock.calls[0] as unknown as [Record<string, unknown>, { onConflict: string }];
    expect(row).toMatchObject({ user_id: "u1", org_id: "o1", activity_geostamp_enabled: false });
    expect(opts.onConflict).toBe("user_id");
  });
});
