// Regression: ISSUE-001 — invalid /pipeline/:dealId crashed page tree
// Found by /qa on 2026-05-12
// Report: .gstack/qa-reports/qa-report-localhost-2026-05-12.md
//
// Root cause: NotFound used <Button asChild leadingIcon={ArrowLeft}>
// <Link>...</Link></Button>. Radix Slot only accepts ONE child but Button
// with asChild + leadingIcon emits two (icon + children) and throws at
// runtime. The thrown error wasn't caught (no error boundary above the
// route) so the whole React tree collapsed to an empty #root.
//
// This test renders DealDetailPage with an invalid :dealId. If the
// asChild + leadingIcon pattern returns, the render throws and the test
// fails — the regression is caught before it ships.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealDetailPage } from "./DealDetailPage";

function renderWithRouter(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/pipeline/:dealId" element={<DealDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DealDetailPage / NotFound", () => {
  it("renders not-found state for an invalid dealId (no crash)", () => {
    // If this throws, the page tree collapses — exactly the bug we shipped.
    expect(() => renderWithRouter("/pipeline/d-does-not-exist")).not.toThrow();

    // Verify the user-visible fallback is present.
    expect(screen.getByText(/Deal not found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to pipeline/i })).toBeInTheDocument();
  });

  it("renders the hero for a valid mock dealId", () => {
    renderWithRouter("/pipeline/d-001"); // Acme Hardware (seeded in MOCK_DEALS)
    expect(screen.getByText(/Acme Hardware/i)).toBeInTheDocument();
  });
});
