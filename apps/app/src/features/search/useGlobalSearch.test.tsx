// useGlobalSearch — verifies the term gate, the three-group mapping to routes,
// and that a per-group error degrades to an empty group (never blanks the rest).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGlobalSearch, sanitizeSearchTerm, phoneQuery } from "./useGlobalSearch";

// Per-table results the mocked query builder resolves to. Each supabase chain
// ends in .limit(), so that's the thenable we resolve.
let tableResults: Record<string, { data: unknown[] | null; error: unknown }>;
// Capture the .or() filter string passed per table, to assert phone terms.
let orCalls: Record<string, string[]>;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.or = (s: string) => {
        (orCalls[table] ??= []).push(s);
        return builder;
      };
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
  orCalls = {};
});

describe("sanitizeSearchTerm", () => {
  it("drops PostgREST-breaking characters and collapses whitespace", () => {
    expect(sanitizeSearchTerm("  Acme, (Inc)  *co* ")).toBe("Acme Inc co");
    expect(sanitizeSearchTerm("a%b\\c")).toBe("a b c");
  });
});

describe("phoneQuery", () => {
  it("returns digits only for a phone-like query in any format", () => {
    expect(phoneQuery("(405) 651-6063")).toBe("4056516063");
    expect(phoneQuery("405-651-6063")).toBe("4056516063");
    expect(phoneQuery("4056516063")).toBe("4056516063");
  });
  it("returns null when letters are present or too few digits", () => {
    expect(phoneQuery("Acme")).toBeNull();
    expect(phoneQuery("suite 12")).toBeNull(); // has letters
    expect(phoneQuery("405")).toBeNull(); // < 4 digits
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

  it("searches the digits-only phone columns for a number query", async () => {
    tableResults.deals = { data: [{ id: "d1", company_name: "Acme Co", contact_name: null, stage: "new" }], error: null };
    const { result } = renderHook(() => useGlobalSearch("(405) 651-6063"), { wrapper });
    await waitFor(() => expect(result.current.results.deals.length).toBe(1));
    expect(orCalls.deals[0]).toContain("contact_phone_digits.ilike.*4056516063*");
    expect(orCalls.partners[0]).toContain("phone_digits.ilike.*4056516063*");
  });

  it("does NOT add a phone term for a text query", async () => {
    const { result } = renderHook(() => useGlobalSearch("Acme"), { wrapper });
    await waitFor(() => expect(result.current.isEnabled).toBe(true));
    await waitFor(() => expect(orCalls.deals?.length).toBe(1));
    expect(orCalls.deals[0]).not.toContain("contact_phone_digits");
    expect(orCalls.deals[0]).toContain("company_name.ilike");
  });

  it("degrades a failing group to empty without losing the others", async () => {
    tableResults.deals = { data: [{ id: "d1", company_name: "Acme Co", contact_name: null, stage: "won" }], error: null };
    tableResults.partners = { data: null, error: { message: "boom" } };

    const { result } = renderHook(() => useGlobalSearch("acme"), { wrapper });
    await waitFor(() => expect(result.current.results.deals.length).toBe(1));
    expect(result.current.results.partners).toEqual([]);
  });
});
