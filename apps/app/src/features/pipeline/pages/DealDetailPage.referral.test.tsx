/**
 * Deal Detail shows who referred the deal, linking to the partner, and shows
 * nothing when the deal has no referral.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealDetailPage } from "./DealDetailPage";
import { MOCK_DEALS } from "../mockData";
import { DEALS_QUERY_KEY } from "../hooks/useDeals";

let dealReferral: {
  referralId: string;
  partnerId: string;
  partnerVisible: boolean;
  partnerName: string | null;
  partnerCompany: string | null;
  partnerCompanySnapshot: string | null;
} | null = null;

vi.mock("@/features/partners/hooks/useDealReferral", () => ({
  useDealReferral: () => ({ data: dealReferral }),
}));

vi.mock("../hooks/useDealContacts", () => ({
  useDealContacts: () => ({ data: [], isLoading: false }),
  useCreateDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderDealDetail() {
  const base = MOCK_DEALS[0]!;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(DEALS_QUERY_KEY(undefined), MOCK_DEALS);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/pipeline/${base.id}`]}>
        <Routes>
          <Route path="/pipeline/:dealId" element={<DealDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DealDetailPage / referred by", () => {
  it("shows who referred the deal, linking to the partner", async () => {
    dealReferral = {
      referralId: "r-1", partnerId: "p-1", partnerVisible: true, partnerName: "Jane",
      partnerCompany: "Jane & Co", partnerCompanySnapshot: "Jane & Co",
    };
    renderDealDetail();
    const link = await screen.findByRole("link", { name: "Jane (Jane & Co)" });
    expect(link).toHaveAttribute("href", "/partners/p-1");
    expect(screen.getByText(/Referred by/)).toBeInTheDocument();
  });

  it("shows plain text, no link, when the partner is outside the viewer's subtree", async () => {
    dealReferral = {
      referralId: "r-2", partnerId: "p-2", partnerVisible: false, partnerName: null,
      partnerCompany: null, partnerCompanySnapshot: "Snap & Co",
    };
    renderDealDetail();
    expect(await screen.findByText("Referred by a partner (Snap & Co)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Snap|Jane/ })).not.toBeInTheDocument();
  });

  it("drops the parenthetical when a hidden partner has no snapshot", async () => {
    dealReferral = {
      referralId: "r-2", partnerId: "p-2", partnerVisible: false, partnerName: null,
      partnerCompany: null, partnerCompanySnapshot: null,
    };
    renderDealDetail();
    expect(await screen.findByText("Referred by a partner")).toBeInTheDocument();
  });

  it("shows no referral line when the deal has none", async () => {
    dealReferral = null;
    renderDealDetail();
    await screen.findByText("Source");
    expect(screen.queryByText(/Referred by/)).not.toBeInTheDocument();
  });
});
