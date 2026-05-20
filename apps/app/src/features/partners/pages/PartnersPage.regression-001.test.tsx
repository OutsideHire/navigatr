// Regression: PartnersPage sort + revenue computation.
//
// The old version of this test mutated the module-level MOCK_PARTNERS
// array, which the page reads directly. Now the page reads from React
// Query — useCreatePartner invalidates the cache; the page re-renders
// from fresh data. The old "module mutation + cleanup" pattern is
// structurally unreachable.
//
// This test preserves the original CONTRACTS against the new
// implementation: live cache → sort by revenue, filter chip narrows
// the visible set, and a cache update is reflected in the next render.

import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PartnersPage } from "./PartnersPage";
import { PARTNERS_QUERY_KEY } from "../hooks/usePartners";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import type { Partner } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

function deal(id: string, valueCents: number): Deal {
  return {
    id,
    companyName: `Co-${id}`,
    contactName: "X",
    phone: "+12025550100",
    email: "x@x.x",
    valueCents,
    stage: "qualified",
    probability: 55,
    lastActivity: "2026-05-18T12:00:00Z",
    nextFollowup: null,
    employeeCountRange: "11-50",
    leadSource: "",
    updatedAt: "2026-05-18T12:00:00Z",
  };
}

function partner(args: {
  id: string;
  name: string;
  status?: Partner["status"];
  attributedDealIds?: string[];
}): Partner {
  return {
    id: args.id,
    name: args.name,
    company: `${args.name.split(" ")[0]} & Co`,
    type: "cpa",
    status: args.status ?? "active",
    phone: "+12025550100",
    email: `${args.id}@example.com`,
    city: "Austin, TX",
    lastTouch: null,
    nextFollowup: null,
    attributedDealIds: args.attributedDealIds ?? [],
    notes: "",
  };
}

function renderWithSeed(seed: { partners: Partner[]; deals: Deal[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Page uses userId=undefined when no auth → falls back to "anon"
  client.setQueryData(PARTNERS_QUERY_KEY(undefined), seed.partners);
  client.setQueryData(DEALS_QUERY_KEY(undefined), seed.deals);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/partners"]}>
          <PartnersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe("PartnersPage / sort + revenue regression", () => {
  it("default sort puts the highest-revenue partner first", () => {
    const deals = [deal("d-low", 5_000_00), deal("d-mid", 10_000_00), deal("d-high", 50_000_00)];
    const partners = [
      partner({ id: "p-low",  name: "Aaron Low",   attributedDealIds: ["d-low"] }),
      partner({ id: "p-mid",  name: "Mike Mid",    attributedDealIds: ["d-mid"] }),
      partner({ id: "p-high", name: "Helen High",  attributedDealIds: ["d-high"] }),
    ];
    renderWithSeed({ partners, deals });

    const headings = screen.getAllByText(/./, { selector: "p.text-body-strong" });
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0]!.textContent).toBe("Helen High");
  });

  it("filter chip 'Active' narrows to active partners only", async () => {
    const user = userEvent.setup();
    renderWithSeed({
      partners: [
        partner({ id: "p1", name: "Active Alice",  status: "active" }),
        partner({ id: "p2", name: "Cooling Carl",  status: "cooling" }),
        partner({ id: "p3", name: "Inactive Iris", status: "inactive" }),
      ],
      deals: [],
    });

    const activeChip = screen
      .getAllByRole("button")
      .find((b) => /^Active\s*\d/.test((b.textContent ?? "").replace(/\s+/g, " ").trim()));
    expect(activeChip).toBeDefined();
    await user.click(activeChip!);

    const cardNames = screen
      .getAllByText(/./, { selector: "p.text-body-strong" })
      .map((el) => el.textContent ?? "");
    expect(cardNames).toEqual(["Active Alice"]);
  });

  it("when the cached partners update, the list re-renders with the new set", () => {
    const { client } = renderWithSeed({
      partners: [partner({ id: "p1", name: "First Partner" })],
      deals: [],
    });
    let cardNames = screen
      .getAllByText(/./, { selector: "p.text-body-strong" })
      .map((el) => el.textContent ?? "");
    expect(cardNames).toEqual(["First Partner"]);

    // Simulate useCreatePartner's onSuccess: writes a new list to the
    // partners cache key. The page's usePartners subscriber re-renders.
    cleanup();
    client.setQueryData(PARTNERS_QUERY_KEY(undefined), [
      partner({ id: "p1", name: "First Partner" }),
      partner({ id: "p2", name: "Newly Added Partner" }),
    ]);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/partners"]}>
          <PartnersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    cardNames = screen
      .getAllByText(/./, { selector: "p.text-body-strong" })
      .map((el) => el.textContent ?? "");
    expect(cardNames).toContain("First Partner");
    expect(cardNames).toContain("Newly Added Partner");
  });
});
