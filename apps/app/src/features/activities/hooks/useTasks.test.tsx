/**
 * useTasks is the single source for the Activities screen's queue, every number
 * derived from it, and the notification bell. These pin the owner predicate.
 *
 * Why a test for one `.eq()`: the `task` table's RLS is `org_id =
 * public.user_org_id()` and nothing more. The Roles bundles routed deals,
 * activities and partners through the hierarchy check and never touched task,
 * so "what RLS allows" is EVERY task in the ISO. Dropping this filter does not
 * fail loudly, it silently turns a personal queue into an org-wide one, which
 * is exactly what reached production.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const ME = "user-1";

/** Filters applied to each `task` select, in call order. */
let taskFilters: Array<Record<string, unknown>>;
let taskRows: Array<Record<string, unknown>>;
let currentUser: { id: string } | null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return b;
      };
      b.order = () => {
        if (table === "task") taskFilters.push({ ...filters });
        return Promise.resolve({ data: taskRows, error: null });
      };
      return b;
    },
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: currentUser }),
}));

import { useTasks } from "./useTasks";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  taskFilters = [];
  taskRows = [];
  currentUser = { id: ME };
});

describe("useTasks", () => {
  it("asks only for the caller's OWN tasks", async () => {
    renderHook(() => useTasks("open"), { wrapper });
    await waitFor(() => expect(taskFilters).toHaveLength(1));
    expect(taskFilters[0]).toMatchObject({ owner_id: ME, status: "open" });
  });

  it("keeps the owner filter when no status filter is applied", async () => {
    // The "all" branch skips the status .eq; it must not skip the owner one.
    renderHook(() => useTasks("all"), { wrapper });
    await waitFor(() => expect(taskFilters).toHaveLength(1));
    expect(taskFilters[0]).toMatchObject({ owner_id: ME });
    expect(taskFilters[0].status).toBeUndefined();
  });

  it("scopes completed tasks too, so History cannot leak either", async () => {
    renderHook(() => useTasks("completed"), { wrapper });
    await waitFor(() => expect(taskFilters).toHaveLength(1));
    expect(taskFilters[0]).toMatchObject({ owner_id: ME, status: "completed" });
  });

  it("issues no query at all when there is no signed-in user", async () => {
    currentUser = null;
    const { result } = renderHook(() => useTasks("open"), { wrapper });
    await waitFor(() => expect(result.current.tasks).toEqual([]));
    expect(taskFilters).toHaveLength(0);
  });
});
