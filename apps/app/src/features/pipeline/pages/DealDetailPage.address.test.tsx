/**
 * The Contact information card shows the deal's REAL address.
 *
 * The bug this replaces: the card printed the literal words "Address on file"
 * where the address belonged, so the one detail a discovered business always
 * carries was fetched from Google Places, paid for, stored on the deal, loaded
 * into the client, and then shown to nobody. `deal.address` was read nowhere in
 * the pipeline feature except the edit form.
 *
 * The same card had a twin placeholder, a hardcoded "Owner", replaced in
 * 15d82de. One of the two was missed, which is why this file exists.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealDetailPage } from "./DealDetailPage";
import { MOCK_DEALS, type Deal } from "../mockData";
import { DEALS_QUERY_KEY } from "../hooks/useDeals";
import { ADDRESS_UNAVAILABLE } from "@/features/path/hooks/useMerchants";

vi.mock("../hooks/useDealContacts", () => ({
  useDealContacts: () => ({ data: [], isLoading: false }),
  useCreateDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

/** The first mock deal, with the fields under test overridden. */
function renderDeal(overrides: Partial<Deal>) {
  const base = MOCK_DEALS[0]!;
  const deals = [{ ...base, ...overrides }, ...MOCK_DEALS.slice(1)];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(DEALS_QUERY_KEY(undefined), deals);
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

describe("DealDetailPage / the address on the Contact information card", () => {
  it("shows the address the deal actually has", () => {
    renderDeal({ address: "1100 Congress Ave, Austin, TX 78701" });
    expect(screen.getByText("1100 Congress Ave, Austin, TX 78701")).toBeInTheDocument();
  });

  it("never prints the old placeholder", () => {
    // The regression itself.
    renderDeal({ address: "1100 Congress Ave, Austin, TX 78701" });
    expect(screen.queryByText(/Address on file/i)).not.toBeInTheDocument();
  });

  it("shows nothing rather than an empty row when the deal has no address", () => {
    renderDeal({ address: null });
    expect(screen.queryByText(/Address on file/i)).not.toBeInTheDocument();
    // The card itself still renders; it is the address line that is absent.
    expect(screen.getByText(/Contact information/i)).toBeInTheDocument();
  });

  it("treats the Path display stand-in as no address, not as a location", () => {
    // Older drop-ins persisted this string into deals.address. Re-displaying it
    // would dress a gap up as somewhere a rep could drive to.
    renderDeal({ address: ADDRESS_UNAVAILABLE });
    expect(screen.queryByText(ADDRESS_UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("does not render a bare ' employees' when the range is unset", () => {
    // Same class of defect, same card: an unset value rendered as though it
    // were one.
    renderDeal({ employeeCountRange: "" });
    expect(screen.queryByText(/^\s*employees$/i)).not.toBeInTheDocument();
  });
});
