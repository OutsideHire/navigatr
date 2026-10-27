/**
 * Deal Detail shows who referred the deal, linking to the partner, and shows
 * nothing when the deal has no referral.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  status?: string;
} | null = null;

vi.mock("@/features/partners/hooks/useDealReferral", () => ({
  useDealReferral: () => ({ data: dealReferral }),
}));

const withdrawMutate = vi.fn();
vi.mock("@/features/partners/hooks/useReferralMutations", () => ({
  useWithdrawReferral: () => ({ mutateAsync: withdrawMutate, isPending: false }),
}));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

vi.mock("@/features/partners/hooks/useReferralUpdates", () => ({
  REFERRAL_UPDATE_MAX: 1000,
  useReferralUpdates: () => ({ data: [] }),
  usePublishReferralUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

let partnerNotes: unknown[] = [];
vi.mock("@/features/partners/hooks/useReferralPartnerNotes", () => ({
  useDealPartnerNotes: () => ({ data: partnerNotes }),
}));


let portalEnabled = true;
vi.mock("@/features/partners/hooks/usePortalAccess", () => ({
  usePortalStatus: () => ({ data: { enabled: portalEnabled, slug: "acme" } }),
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

beforeEach(() => {
  partnerNotes = [];
  portalEnabled = true;
  withdrawMutate.mockReset();
  toastSuccess.mockReset();
});

describe("DealDetailPage / referred by", () => {
  it("hides Share update with partner when the org's portal is off", async () => {
    portalEnabled = false;
    dealReferral = {
      referralId: "r-1", partnerId: "p-1", partnerVisible: true, partnerName: "Jane",
      partnerCompany: "Jane & Co", partnerCompanySnapshot: "Jane & Co",
    };
    renderDealDetail();
    expect(await screen.findByRole("link", { name: "Jane (Jane & Co)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share update with partner" })).not.toBeInTheDocument();
  });

  it("shows who referred the deal, linking to the partner", async () => {
    dealReferral = {
      referralId: "r-1", partnerId: "p-1", partnerVisible: true, partnerName: "Jane",
      partnerCompany: "Jane & Co", partnerCompanySnapshot: "Jane & Co",
    };
    renderDealDetail();
    const link = await screen.findByRole("link", { name: "Jane (Jane & Co)" });
    expect(link).toHaveAttribute("href", "/partners/p-1");
    expect(screen.getByText(/Referred by/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share update with partner" })).toBeInTheDocument();
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

  it("names a partner the viewer cannot open, read-only with no link (FR-PORT-55)", async () => {
    dealReferral = {
      referralId: "r-3", partnerId: "p-3", partnerVisible: false, partnerName: "Jane CPA",
      partnerCompany: "Jane & Co", partnerCompanySnapshot: "Old Snap",
    };
    renderDealDetail();
    expect(await screen.findByText("Referred by Jane CPA (Jane & Co)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Jane/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Share update with partner" }));
    expect(await screen.findByText("Share an update with Jane CPA")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Share update with partner" })).not.toBeInTheDocument();
  });

  it("shows what a partner wrote back on a referral this deal was sent to them", async () => {
    dealReferral = null;
    partnerNotes = [
      { referralId: "r-9", partnerId: "p-9", partnerName: "Kim CPA", notes: [{ id: "n-1", body: "Signed today.", createdAt: "2026-10-22T12:00:00Z" }] },
    ];
    renderDealDetail();
    const group = await screen.findByRole("region", { name: "Notes from Kim CPA" });
    expect(within(group).getByText("Signed today.")).toBeInTheDocument();
  });

  it("withdraws an accepted referral at the partner's request, with an optional internal note", async () => {
    dealReferral = {
      referralId: "r-5", partnerId: "p-1", partnerVisible: true, partnerName: "Jane",
      partnerCompany: "Jane & Co", partnerCompanySnapshot: "Jane & Co", status: "accepted",
    };
    withdrawMutate.mockResolvedValueOnce(undefined);
    renderDealDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw (partner asked)" }));
    expect(withdrawMutate).not.toHaveBeenCalled();
    await userEvent.type(screen.getByPlaceholderText("Internal note (optional)"), "Emailed us");
    await userEvent.click(screen.getByRole("button", { name: "Withdraw referral" }));
    await waitFor(() => expect(withdrawMutate).toHaveBeenCalledWith({ referralId: "r-5", note: "Emailed us" }));
    expect(toastSuccess).toHaveBeenCalledWith("Referral withdrawn. The partner will see Withdrawn.");
  });

  it("offers withdraw on a working referral but not on a won or lost one", async () => {
    dealReferral = {
      referralId: "r-6", partnerId: "p-1", partnerVisible: true, partnerName: "Jane",
      partnerCompany: "Jane & Co", partnerCompanySnapshot: "Jane & Co", status: "working",
    };
    const first = renderDealDetail();
    expect(await screen.findByRole("button", { name: "Withdraw (partner asked)" })).toBeInTheDocument();
    first.unmount();
    dealReferral = { ...dealReferral, status: "won" };
    renderDealDetail();
    await screen.findByText(/Referred by/);
    expect(screen.queryByRole("button", { name: "Withdraw (partner asked)" })).not.toBeInTheDocument();
  });
});
