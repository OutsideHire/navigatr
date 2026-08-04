// useGlobalSearch — verifies the term gate, the three-group mapping to routes,
// and that a per-group error degrades to an empty group (never blanks the rest).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGlobalSearch, sanitizeSearchTerm } from "./useGlobalSearch";

// Per-table results the mocked query builder resolves to. Each supabase chain
// ends in .limit(), so that's the thenable we resolve.
let tableResults: Record<string, { data: unknown[] | null; error: unknown }>;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.or = chain;
      builder.ilike = chain;
      builder.order = chain;
      builder.limit = () => Promise.resolve(tableResults[table] ?? { data: [], error: null });
      return builder;
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  tableResults = { deals: { data: [], error: null }, partners: { data: [], error: null }, activities: { data: [], error: null } };
});

describe("sanitizeSearchTerm", () => {
  it("drops PostgREST-breaking characters and collapses whitespace", () => {
    expect(sanitizeSearchTerm("  Acme, (Inc)  *co* ")).toBe("Acme Inc co");
    expect(sanitizeSearchTerm("a%b\\c")).toBe("a b c");
  });
});

describe("useGlobalSearch", () => {
  it("is disabled and returns empty until 2+ characters", () => {
    const { result } = renderHook(() => useGlobalSearch("a"), { wrapper });
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.results).toEqual({ deals: [], partners: [], activities: [] });
  });

  it("maps each group to labels + routes", async () => {
    tableResults.deals = { data: [{ id: "d1", company_name: "Acme Co", contact_name: "Al", stage: "new" }], error: null };
    tableResults.partners = { data: [{ id: "p1", name: "First Bank", company: "First Bank NA" }], error: null };
    tableResults.activities = {
      data: [{ id: "a1", type: "call", outcome_notes: "left a voicemail", occurred_at: "2026-08-01T00:00:00Z", deal_id: "d9", deals: { company_name: "Acme Co" } }],
      error: null,
    };

    const { result } = renderHook(() => useGlobalSearch("acme"), { wrapper });
    await waitFor(() => expect(result.current.results.deals.length).toBe(1));

    expect(result.current.results.deals[0]).toMatchObject({ kind: "deal", label: "Acme Co", to: "/pipeline/d1" });
    expect(result.current.results.deals[0].sublabel).toBe("Al · New");
    expect(result.current.results.partners[0]).toMatchObject({ kind: "partner", label: "First Bank", to: "/partners/p1" });
    expect(result.current.results.activities[0]).toMatchObject({ kind: "activity", label: "Call: Acme Co", to: "/pipeline/d9" });
  });

  it("degrades a failing group to empty without losing the others", async () => {
    tableResults.deals = { data: [{ id: "d1", company_name: "Acme Co", contact_name: null, stage: "won" }], error: null };
    tableResults.partners = { data: null, error: { message: "boom" } };

    const { result } = renderHook(() => useGlobalSearch("acme"), { wrapper });
    await waitFor(() => expect(result.current.results.deals.length).toBe(1));
    expect(result.current.results.partners).toEqual([]);
  });
});
