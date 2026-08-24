import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEmailSuggestions } from "./useEmailSuggestions";

let rows: unknown[];
const eqCalls: Array<[string, unknown]> = [];
function builder() {
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return b;
  });
  b.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return b;
}
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => builder() },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: [{ id: "d1", companyName: "Acme Co" }], isSuccess: true }),
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  rows = [];
  eqCalls.length = 0;
});

describe("useEmailSuggestions", () => {
  it("returns suggested rows shaped as views with the deal company name", async () => {
    rows = [
      {
        id: "e1",
        subject: "Proposal",
        recipients: ["jane@acme.com", "bob@acme.com"],
        sent_at: "2026-08-20T10:00:00.000Z",
        matched_deal_id: "d1",
        deep_link_url: "https://outlook/1",
      },
    ];
    const { result } = renderHook(() => useEmailSuggestions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: "e1",
        subject: "Proposal",
        recipientSummary: "jane@acme.com +1",
        sentAt: "2026-08-20T10:00:00.000Z",
        dealId: "d1",
        companyName: "Acme Co",
        deepLinkUrl: "https://outlook/1",
      },
    ]);
  });

  it("filters to the caller's own suggested rows", async () => {
    renderHook(() => useEmailSuggestions(), { wrapper: wrapper() });
    await waitFor(() => expect(eqCalls.length).toBeGreaterThanOrEqual(2));
    expect(eqCalls).toContainEqual(["sender_user_id", "user-1"]);
    expect(eqCalls).toContainEqual(["status", "suggested"]);
  });

  it("returns empty when there are no suggestions", async () => {
    rows = [];
    const { result } = renderHook(() => useEmailSuggestions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
