// Regression: PartnersPage sort + revenue computation (Session 19 QA, 2026-05-17)
//
// Two contracts pinned by this test, both real bug-classes from earlier QA
// passes in adjacent features:
//
// 1. List sort by revenue is deterministic and matches the per-partner
//    attribution from MOCK_DEALS. If the sort comparator gets refactored
//    and accidentally compares names first, or the revenue lookup loses
//    its refreshKey dep, this test fails.
//
// 2. After appendActivity-style mutation (here: pushing a new partner
//    into MOCK_PARTNERS) the page reflects it on next render. Same
//    family as Activities ISSUE-001 (setState bailout).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PartnersPage } from "./PartnersPage";
import { MOCK_PARTNERS } from "../mockData";
import { MOCK_DEALS } from "@/features/pipeline/mockData";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/partners"]}>
        <PartnersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PartnersPage / sort + revenue regression", () => {
  let snapshot: typeof MOCK_PARTNERS;

  beforeEach(() => {
    snapshot = [...MOCK_PARTNERS];
  });

  afterEach(() => {
    MOCK_PARTNERS.length = 0;
    MOCK_PARTNERS.push(...snapshot);
  });

  it("default sort puts the highest-revenue partner first", () => {
    // Compute the expected top partner by hand from the mock data.
    const dealById = new Map(MOCK_DEALS.map((d) => [d.id, d]));
    const revenueByPartner = new Map<string, number>();
    for (const p of MOCK_PARTNERS) {
      let sum = 0;
      for (const id of p.attributedDealIds) {
        const d = dealById.get(id);
        if (d) sum += d.valueCents;
      }
      revenueByPartner.set(p.id, sum);
    }
    // Highest revenue partner per the mock data:
    const topExpected = MOCK_PARTNERS
      .slice()
      .sort((a, b) => (revenueByPartner.get(b.id) ?? 0) - (revenueByPartner.get(a.id) ?? 0))[0]!;

    renderPage();

    // The first card heading text should match the top-revenue partner.
    // PartnerCard renders the name in a p.text-body-strong.
    const headings = screen.getAllByText(/./, { selector: "p.text-body-strong" });
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]!.textContent).toBe(topExpected.name);
  });

  it("filter chip 'Active' narrows to active partners only", async () => {
    const user = userEvent.setup();
    renderPage();

    // Click the Active chip — Chip is a button with aria-pressed
    const activeChip = screen
      .getAllByRole("button")
      .find((b) => /^Active\s*\d/.test((b.textContent ?? "").replace(/\s+/g, " ").trim()));
    expect(activeChip).toBeDefined();
    await user.click(activeChip!);

    // After filter, every visible card name should be an active partner.
    const activeNames = new Set(
      snapshot.filter((p) => p.status === "active").map((p) => p.name),
    );
    const cardNames = screen
      .getAllByText(/./, { selector: "p.text-body-strong" })
      .map((el) => el.textContent ?? "");

    // Every rendered name must be in the active set.
    for (const name of cardNames) {
      expect(activeNames.has(name)).toBe(true);
    }
    // And we must have at least one card.
    expect(cardNames.length).toBeGreaterThan(0);
  });

  it("new partner appended via MOCK_PARTNERS surfaces after re-mount", () => {
    renderPage();
    const baselineCount = screen
      .getAllByText(/./, { selector: "p.text-body-strong" }).length;

    MOCK_PARTNERS.unshift({
      id: "p-test-001",
      name: "QA Regression Partner",
      company: "QA Test Co",
      type: "cpa",
      status: "active",
      phone: "+12025550199",
      email: "qa@test.co",
      city: "Austin, TX",
      lastTouch: null,
      nextFollowup: null,
      attributedDealIds: [],
      notes: "",
    });

    cleanup();
    renderPage();

    const afterCount = screen
      .getAllByText(/./, { selector: "p.text-body-strong" }).length;
    expect(afterCount).toBe(baselineCount + 1);
    expect(screen.getByText(/QA Regression Partner/)).toBeInTheDocument();
  });
});
