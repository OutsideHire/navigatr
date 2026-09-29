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

/**
 * Website. Requested from Places and stored on prospects since discovery
 * shipped, but `deals` had no column for it at all, so the drop-in insert
 * dropped a field we had already fetched and paid for.
 */
describe("DealDetailPage / the website on the Contact information card", () => {
  it("shows the website as a link a rep can open", () => {
    renderDeal({ website: "https://bluefrogplumbing.com" });
    const link = screen.getByRole("link", { name: /bluefrogplumbing\.com/i });
    expect(link).toHaveAttribute("href", "https://bluefrogplumbing.com/");
  });

  it("drops the scheme from the label, because that is what a rep recognises", () => {
    renderDeal({ website: "https://www.bakitchenandbath.com/" });
    expect(screen.getByRole("link", { name: "www.bakitchenandbath.com" })).toBeInTheDocument();
  });

  it("shows nothing when the deal has no website", () => {
    renderDeal({ website: null });
    expect(screen.queryByRole("link", { name: /\./ })).not.toBeInTheDocument();
  });

  it("refuses a javascript: URL rather than rendering it as a link", () => {
    // The value comes from third-party data, so the scheme is checked rather
    // than trusted. A rep must never be one tap from executing what an external
    // record happened to contain.
    renderDeal({ website: "javascript:alert(1)" });
    expect(screen.queryByRole("link", { name: /alert/i })).not.toBeInTheDocument();
  });

  it("refuses a value that is not a URL at all", () => {
    renderDeal({ website: "not a url" });
    expect(screen.queryByRole("link", { name: /not a url/i })).not.toBeInTheDocument();
  });
});

/**
 * The empty card. Robert hit this on staging: every row in this card is
 * conditional, so a deal with none of them left a heading floating over an
 * empty box. It reads as broken even though the deal genuinely has nothing.
 *
 * It looked populated before only because the card printed "Address on file"
 * and a bare " employees" whether or not either was true. Removing those lies
 * without saying anything in their place is what created this.
 */
describe("DealDetailPage / a deal with no contact details at all", () => {
  const bare = {
    phone: "", email: "", address: null, website: null, employeeCountRange: "",
  } as const;

  it("says so rather than leaving the heading over an empty box", () => {
    renderDeal(bare);
    expect(screen.getByText(/no contact details yet/i)).toBeInTheDocument();
  });

  it("points the rep at where to add them", () => {
    renderDeal(bare);
    expect(screen.getByText(/use edit to add/i)).toBeInTheDocument();
  });

  it("keeps the card itself, so the layout does not jump", () => {
    renderDeal(bare);
    expect(screen.getByText(/contact information/i)).toBeInTheDocument();
  });

  it.each([
    ["a phone", { ...bare, phone: "(415) 555-0109" }],
    ["an email", { ...bare, email: "robert@getnavigatr.io" }],
    ["an address", { ...bare, address: "2141 Trosper Lane, Midwest City, OK" }],
    ["a website", { ...bare, website: "https://bluefrog.example" }],
    ["an employee count", { ...bare, employeeCountRange: "1-9" }],
  ])("stays quiet when the deal has %s", (_label, overrides) => {
    // One real detail is enough; the empty state must not shout over it.
    renderDeal(overrides);
    expect(screen.queryByText(/no contact details yet/i)).not.toBeInTheDocument();
  });
});
