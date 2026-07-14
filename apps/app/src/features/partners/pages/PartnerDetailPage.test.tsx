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

// usePartner is the page's source for the partner. The old test relied
// on useAuth resolving to undefined so usePartners stayed disabled and
// returned the seeded PARTNERS_QUERY_KEY(undefined) cache. That's
// fragile: giving useAuth a real user id would *enable* the query and
// have it refetch (clobbering the seed). Instead we mock usePartner to
// return the partner the test seeds for, deterministically — no
// reliance on auth resolving to undefined.
const partnerResult: { partner: Partner | undefined } = { partner: undefined };
vi.mock("../hooks/usePartner", () => ({
  usePartner: () => ({ partner: partnerResult.partner, isLoading: false, isError: false }),
}));

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

// Profile + auth drive the Edit-button gate. Defaults set per test via
// the mutable holders below.
const profileHolder: { role: "rep" | "manager" | "admin" } = { role: "rep" };
// Default undefined so the existing inbound/outbound referral tests (which
// seed DEALS_QUERY_KEY(undefined)) keep matching — useDeals keys its query
// on this auth id. The gating tests set it explicitly in their beforeEach.
let authUserId: string | undefined = undefined;
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role: profileHolder.role, org_id: "org-1" } }),
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));
// EditPartnerSheet is exercised in its own test; stub it to a marker so
// this test only asserts the button + open wiring.
vi.mock("../components/EditPartnerSheet", () => ({
  EditPartnerSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-partner-sheet" /> : null,
}));
vi.mock("../components/PartnerNotesCard", () => ({
  PartnerNotesCard: () => <div data-testid="partner-notes-card" />,
}));
vi.mock("../components/ReferralPreviewSheet", () => ({
  ReferralPreviewSheet: ({ deal, open }: { deal: { id: string } | null; open: boolean }) =>
    open && deal ? <div data-testid="referral-preview" data-deal={deal.id} /> : null,
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
  createdBy?: string | null;
  lastTouch?: string | null;
  createdAt?: string;
  followupCadenceDays?: number | null;
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
    lastTouch: args.lastTouch ?? null,
    nextFollowup: null,
    attributedDealIds: args.attributedDealIds ?? [],
    outboundDealIds: args.outboundDealIds ?? [],
    notes: "",
    createdBy: args.createdBy ?? "creator-9",
    createdAt: args.createdAt,
    followupCadenceDays: args.followupCadenceDays,
  };
}

function renderPage(seed: { partners: Partner[]; deals: Deal[]; partnerId: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // usePartner is mocked; point it at the seeded partner for this id.
  partnerResult.partner = seed.partners.find((p) => p.id === seed.partnerId);
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

describe("PartnerDetailPage / Edit button gating", () => {
  beforeEach(() => {
    profileHolder.role = "rep";
    authUserId = "creator-9";
  });

  // The NotesCard renders its own "Edit" button (and the timeline card a
  // second "Log touch"), so scope the hero Edit query to the hero action
  // row: the parent of the first "Log touch" (HeroCard renders before the
  // timeline card). That row holds only Log touch + the gated Edit.
  const heroActions = () =>
    screen.getAllByRole("button", { name: "Log touch" })[0].parentElement as HTMLElement;

  it("shows Edit for the rep who created the partner", () => {
    const partners = [partner({ id: "p1", createdBy: "creator-9" })];
    renderPage({ partners, deals: [], partnerId: "p1" });
    expect(within(heroActions()).getByRole("button", { name: /^Edit$/ })).toBeTruthy();
  });

  it("hides Edit for a rep who did not create the partner", () => {
    authUserId = "someone-else";
    const partners = [partner({ id: "p1", createdBy: "creator-9" })];
    renderPage({ partners, deals: [], partnerId: "p1" });
    expect(within(heroActions()).queryByRole("button", { name: /^Edit$/ })).toBeNull();
  });

  it("shows Edit for a manager regardless of creator", () => {
    profileHolder.role = "manager";
    authUserId = "someone-else";
    const partners = [partner({ id: "p1", createdBy: "creator-9" })];
    renderPage({ partners, deals: [], partnerId: "p1" });
    expect(within(heroActions()).getByRole("button", { name: /^Edit$/ })).toBeTruthy();
  });

  it("opens the edit sheet when Edit is clicked", () => {
    const partners = [partner({ id: "p1", createdBy: "creator-9" })];
    renderPage({ partners, deals: [], partnerId: "p1" });
    fireEvent.click(within(heroActions()).getByRole("button", { name: /^Edit$/ }));
    expect(screen.getByTestId("edit-partner-sheet")).toBeTruthy();
  });
});

describe("PartnerDetailPage / notes + about", () => {
  it("renders the About card and the Notes feed", () => {
    const partners = [partner({ id: "p1", createdBy: "creator-9" })];
    renderPage({ partners, deals: [], partnerId: "p1" });
    expect(screen.getByRole("heading", { name: "About" })).toBeTruthy();
    expect(screen.getByTestId("partner-notes-card")).toBeTruthy();
  });
});

describe("PartnerDetailPage / referral preview", () => {
  // useDeals keys its query on the auth user id; the seed lives at
  // DEALS_QUERY_KEY(undefined). Reset the leaked id from the gating
  // describe back to the documented default so the seeded deal resolves.
  beforeEach(() => {
    authUserId = undefined;
  });

  it("clicking a referral row opens the preview panel (no navigation)", () => {
    const deals = [deal("d-in", 10_000_00)];
    const partners = [partner({ id: "p1", attributedDealIds: ["d-in"] })];
    renderPage({ partners, deals, partnerId: "p1" });

    fireEvent.click(screen.getByText("Co-d-in").closest("button")!);
    const preview = screen.getByTestId("referral-preview");
    expect(preview).toBeTruthy();
    expect(preview.getAttribute("data-deal")).toBe("d-in");
  });
});

describe("PartnerDetailPage / cadence", () => {
  it("shows the cadence line and an overdue chip when past due", () => {
    const partners = [
      partner({
        id: "p1",
        createdBy: "creator-9",
        followupCadenceDays: 30,
        lastTouch: "2020-01-01T12:00:00Z", // long ago → overdue
      }),
    ];
    renderPage({ partners, deals: [], partnerId: "p1" });
    expect(screen.getByText(/Every 30 days/)).toBeTruthy();
    expect(screen.getByText(/Overdue/)).toBeTruthy();
  });
});
