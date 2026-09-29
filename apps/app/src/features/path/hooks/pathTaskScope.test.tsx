/**
 * The two Path tiers that read `task` directly: owed (past-due) and due-today
 * drop-ins. Both feed the rep's day.
 *
 * This is the more serious half of the task-scoping defect. The `task` RLS
 * policy is `org_id = public.user_org_id()` with no owner or hierarchy gate, so
 * an unfiltered read here does not merely show a colleague's row, it routes
 * their owed visits onto THIS rep's day as stops with a Navigate button. The
 * only thing that ever narrowed it was incidental: the follow-up deals lookup
 * IS hierarchy-scoped, so a task on a deal the rep cannot see fell out. That is
 * deal visibility, not task assignment, and it is not something to rely on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const ME = "user-1";
const PATH_DATE = "2026-09-22";

let taskFilters: Array<Record<string, unknown>>;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (col: string, val: unknown) => { filters[col] = val; return b; };
      b.lte = (col: string, val: unknown) => { filters[col + "__lte"] = val; return b; };
      b.in = () => b;
      b.not = () => b;
      b.order = () => b;
      // Thenable, so awaiting the chain resolves whichever call ends it. Every
      // task read returns NOTHING, which short-circuits both hooks before the
      // deals/prospects joins: the filters are the whole subject here.
      b.then = (res: (v: unknown) => unknown) => {
        if (table === "task") taskFilters.push({ ...filters });
        return Promise.resolve({ data: [], error: null }).then(res);
      };
      return b;
    },
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: ME } }),
}));

import { useOwedVisits } from "./useOwedVisits";
import { useDueTodayVisits } from "./useDueTodayVisits";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  taskFilters = [];
});

describe("Path day tiers read only the rep's OWN tasks", () => {
  it("useOwedVisits scopes the owed drop-in read to the rep", async () => {
    renderHook(() => useOwedVisits(PATH_DATE), { wrapper });
    await waitFor(() => expect(taskFilters).toHaveLength(1));
    expect(taskFilters[0]).toMatchObject({
      owner_id: ME,
      type: "drop_in",
      status: "open",
      earliest_at__lte: PATH_DATE,
    });
  });

  it("useDueTodayVisits scopes the due-today drop-in read to the rep", async () => {
    renderHook(() => useDueTodayVisits(PATH_DATE), { wrapper });
    await waitFor(() => expect(taskFilters).toHaveLength(1));
    expect(taskFilters[0]).toMatchObject({
      owner_id: ME,
      type: "drop_in",
      status: "open",
      earliest_at: PATH_DATE,
    });
  });
});
