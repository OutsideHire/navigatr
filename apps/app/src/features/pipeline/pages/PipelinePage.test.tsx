import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { computeKpis, PipelinePage } from "./PipelinePage";
import type { Deal } from "../mockData";
import { MOCK_DEALS } from "../mockData";

// This project's vitest env doesn't ship a fully-functional jsdom
// localStorage; usePersistedViewMode reads it on mount. Install a small
// in-memory shim so the page renders (mirrors CookieBanner.test.tsx).
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      get length() { return store.size; },
      clear() { store.clear(); },
      getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
      key(i: number) { return Array.from(store.keys())[i] ?? null; },
      removeItem(key: string) { store.delete(key); },
      setItem(key: string, value: string) { store.set(key, value); },
    },
    writable: true,
    configurable: true,
  });
});

vi.mock("../hooks/useDeals", () => ({
  useDeals: () => ({ data: MOCK_DEALS, isLoading: false }),
}));
vi.mock("@/features/profession/useTerm", () => ({
  useTerm: (k: string) => k,
  useTermCapitalized: (k: string) => k.charAt(0).toUpperCase() + k.slice(1),
}));

function d(over: Partial<Deal>): Deal {
  return { ...MOCK_DEALS[0], ...over };
}

describe("computeKpis", () => {
  it("sums open-stage pipeline + weighted and counts active deals", () => {
    const deals = [
      d({ id: "a", stage: "new", valueCents: 100_00, probability: 20 }),
      d({ id: "b", stage: "qualified", valueCents: 200_00, probability: 50 }),
      d({ id: "c", stage: "won", valueCents: 999_00, probability: 100 }),
    ];
    const k = computeKpis(deals);
    expect(k.activeDeals).toBe(2);
    expect(k.totalPipeline).toBe(300_00);
    expect(k.weighted).toBe(100_00 * 0.2 + 200_00 * 0.5);
  });

  it("returns zeros for an empty list", () => {
    expect(computeKpis([])).toEqual(
      expect.objectContaining({ totalPipeline: 0, weighted: 0, activeDeals: 0 }),
    );
  });
});

describe("PipelinePage", () => {
  function renderPage() {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><PipelinePage /></MemoryRouter>
      </QueryClientProvider>,
    );
  }
  it("renders a computed header subhead with active deals + weighted", () => {
    renderPage();
    // The subhead is the single element matching the full "N active deals ·
    // … weighted" sentence; the KPI tiles render "Active deals"/"Weighted"
    // as separate eyebrow nodes, so scope to the combined-sentence node.
    expect(screen.getByText(/active deals · .* weighted/i)).toBeInTheDocument();
  });
  it("renders the four KPI tiles", () => {
    renderPage();
    expect(screen.getByText(/total pipeline/i)).toBeInTheDocument();
    // "Active deals" appears in both the subhead and a KPI eyebrow.
    expect(screen.getAllByText(/active deals/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/won this month/i)).toBeInTheDocument();
  });
  it("renders deal cards for the loaded deals", () => {
    renderPage();
    // Kanban default renders the card in both the lg+ board and the
    // below-lg fallback grid (CSS hides one; jsdom keeps both), so the
    // company name appears more than once.
    expect(screen.getAllByText(MOCK_DEALS[0].companyName).length).toBeGreaterThan(0);
  });
});
