// PartnerDetailPage — inbound + outbound referral sections.
//
// The page renders TWO ReferralSection cards: "Referred to us" (inbound,
// from partner.attributedDealIds) and "Referred to them" (outbound, from
// partner.outboundDealIds). Both read deal rows out of the deals cache.
//
// We seed the partners + deals React Query caches (same keys the page
// subscribes to) so a partner with BOTH inbound and outbound links
// renders, and mock the referral mutation hooks as capturable spies so
// we can assert that the outbound add goes through useReferDeal.

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PartnerDetailPage } from "./PartnerDetailPage";
import { PARTNERS_QUERY_KEY } from "../hooks/usePartners";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import type { Partner } from "../mockData";
import type { Deal } from "@/features/pipeline/mockData";

// Capturable spies for the mutation hooks. Each hook returns an object
// with mutateAsync; we assert against these.
const attributeMutate = vi.fn().mockResolvedValue(undefined);
const referMutate = vi.fn().mockResolvedValue(undefined);
const unattributeMutate = vi.fn().mockResolvedValue(undefined);

vi.mock("../hooks/useAttributeDeal", () => ({
  useAttributeDeal: () => ({ mutateAsync: attributeMutate, isPending: false }),
  useUnattributeDeal: () => ({ mutateAsync: unattributeMutate, isPending: false }),
}));
vi.mock("../hooks/useReferDeal", () => ({
  useReferDeal: () => ({ mutateAsync: referMutate, isPending: false }),
}));

function deal(id: string, valueCents: number): Deal {
  return {
    id,
    companyName: `Co-${id}`,
    contactName: `Contact ${id}`,
    phone: "+12025550100",
    email: "x@x.x",
    valueCents,
    stage: "qualified",
    probability: 55,
    lastActivity: "2026-05-18T12:00:00Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "11-50",
    leadSource: "",
    updatedAt: "2026-05-18T12:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
}

function partner(args: {
  id: string;
  attributedDealIds?: string[];
  outboundDealIds?: string[];
}): Partner {
  return {
    id: args.id,
    name: "Pat Partner",
    company: "Pat & Co",
    type: "cpa",
    status: "active",
    phone: "+12025550100",
    email: `${args.id}@example.com`,
    city: "Austin, TX",
    lastTouch: null,
    nextFollowup: null,
    attributedDealIds: args.attributedDealIds ?? [],
    outboundDealIds: args.outboundDealIds ?? [],
    notes: "",
  };
}

function renderPage(seed: { partners: Partner[]; deals: Deal[]; partnerId: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(PARTNERS_QUERY_KEY(undefined), seed.partners);
  client.setQueryData(DEALS_QUERY_KEY(undefined), seed.deals);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/partners/${seed.partnerId}`]}>
        <Routes>
          <Route path="/partners/:partnerId" element={<PartnerDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Radix Select uses pointer APIs + scrollIntoView that jsdom lacks.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

describe("PartnerDetailPage / inbound + outbound referrals", () => {
  beforeEach(() => {
    attributeMutate.mockClear();
    referMutate.mockClear();
    unattributeMutate.mockClear();
  });

  it("renders both referral sections, each with its deal", () => {
    const deals = [deal("d-in", 10_000_00), deal("d-out", 20_000_00)];
    const partners = [
      partner({ id: "p1", attributedDealIds: ["d-in"], outboundDealIds: ["d-out"] }),
    ];
    renderPage({ partners, deals, partnerId: "p1" });

    const inbound = screen.getByRole("heading", { name: /Referred to us/i });
    const outbound = screen.getByRole("heading", { name: /Referred to them/i });
    expect(inbound).toBeTruthy();
    expect(outbound).toBeTruthy();

    // Each section's deal lands in the right card.
    const inboundCard = inbound.closest("div[class*='rounded']") ?? inbound.parentElement!.parentElement!;
    const outboundCard = outbound.closest("div[class*='rounded']") ?? outbound.parentElement!.parentElement!;
    expect(within(inboundCard as HTMLElement).getByText("Co-d-in")).toBeTruthy();
    expect(within(outboundCard as HTMLElement).getByText("Co-d-out")).toBeTruthy();
  });

  it("shows the outbound add control ('Refer a deal')", () => {
    const deals = [deal("d-in", 10_000_00), deal("d-out", 20_000_00), deal("d-free", 5_000_00)];
    const partners = [
      partner({ id: "p1", attributedDealIds: ["d-in"], outboundDealIds: ["d-out"] }),
    ];
    renderPage({ partners, deals, partnerId: "p1" });

    expect(screen.getByRole("button", { name: "Refer a deal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach deal" })).toBeTruthy();
  });

  it("outbound add calls useReferDeal (not useAttributeDeal)", async () => {
    const deals = [deal("d-free", 5_000_00)];
    const partners = [partner({ id: "p1" })];
    renderPage({ partners, deals, partnerId: "p1" });

    // Open the outbound picker, open the Radix select, pick the option.
    fireEvent.click(screen.getByRole("button", { name: "Refer a deal" }));
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Co-d-free/ }));
    // The confirm button is labelled exactly "Attach" / "Attaching…";
    // the inbound section's open-picker button is "Attach deal".
    fireEvent.click(screen.getByRole("button", { name: /^Attach(ing…)?$/ }));

    await waitFor(() => expect(referMutate).toHaveBeenCalledTimes(1));
    expect(referMutate).toHaveBeenCalledWith({ partnerId: "p1", dealId: "d-free" });
    expect(attributeMutate).not.toHaveBeenCalled();
  });

  it("KPI deal count reflects inbound only", () => {
    const deals = [deal("d-in", 10_000_00), deal("d-out1", 1), deal("d-out2", 2)];
    const partners = [
      partner({ id: "p1", attributedDealIds: ["d-in"], outboundDealIds: ["d-out1", "d-out2"] }),
    ];
    renderPage({ partners, deals, partnerId: "p1" });

    // REFERRALS KPI = inbound count = 1 (not 3).
    const kpi = screen.getByText("REFERRALS").parentElement!;
    expect(within(kpi).getByText("1")).toBeTruthy();
  });
});
