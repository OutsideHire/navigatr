import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const limitMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      calls.push(["from", table]);
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return chain; },
        limit: (...a: unknown[]) => { calls.push(["limit", ...a]); return limitMock(); },
      };
      return chain;
    },
  },
}));

import { usePartnerProfileChanges } from "./usePartnerProfileChanges";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  limitMock.mockReset();
  calls.length = 0;
});

describe("usePartnerProfileChanges", () => {
  it("reads the latest three changes the partner made, newest first", async () => {
    limitMock.mockResolvedValueOnce({
      data: [
        { id: "c-2", field: "phone", old_value: "5550100100", new_value: null, changed_at: "2026-10-16T12:00:00Z" },
        { id: "c-1", field: "name", old_value: "Jane CPA", new_value: "Jane Smith", changed_at: "2026-10-15T12:00:00Z" },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartnerProfileChanges("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: "c-2", field: "phone", oldValue: "5550100100", newValue: null, changedAt: "2026-10-16T12:00:00Z" },
      { id: "c-1", field: "name", oldValue: "Jane CPA", newValue: "Jane Smith", changedAt: "2026-10-15T12:00:00Z" },
    ]);
    expect(calls).toEqual([
      ["from", "partner_profile_changes"],
      ["select", "id, field, old_value, new_value, changed_at"],
      ["eq", "partner_id", "p-1"],
      ["order", "changed_at", { ascending: false }],
      ["limit", 3],
    ]);
  });

  it("does not query without a partner", () => {
    renderHook(() => usePartnerProfileChanges(undefined), { wrapper });
    expect(calls).toEqual([]);
  });
});
