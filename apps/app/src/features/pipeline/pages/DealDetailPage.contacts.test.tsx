// Contacts tab wiring — Task 3 of the Deal Contacts feature.
//
// Asserts the Contacts tab now renders the real ContactsTab (primary
// contact + "Add contact"), not the "Coming in sprint 2" placeholder.
//
// useDealContacts is mocked so no real supabase call fires.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealDetailPage } from "./DealDetailPage";
import { MOCK_DEALS } from "../mockData";
import { DEALS_QUERY_KEY } from "../hooks/useDeals";

vi.mock("../hooks/useDealContacts", () => ({
  useDealContacts: () => ({ data: [], isLoading: false }),
  useCreateDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDealContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderWithRouter(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(DEALS_QUERY_KEY(undefined), MOCK_DEALS);
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

describe("DealDetailPage / Contacts tab", () => {
  it("renders ContactsTab (primary contact + Add contact), not the placeholder", async () => {
    const user = userEvent.setup();
    renderWithRouter("/pipeline/d-001"); // Acme Hardware — primary contact Marcus Reed

    await user.click(screen.getByRole("tab", { name: /Contacts/i }));

    // The active tabpanel is ContactsTab — scope assertions to it so the
    // hero's "Marcus Reed · Owner" line doesn't collide with the primary
    // contact card.
    const panel = await screen.findByRole("tabpanel");

    // Primary contact name from the deal row.
    expect(within(panel).getByText("Marcus Reed")).toBeInTheDocument();
    // Primary label + Add-contact affordance from ContactsTab.
    expect(within(panel).getByText(/^Primary$/i)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Add contact/i })).toBeInTheDocument();
    // The old placeholder must be gone.
    expect(screen.queryByText(/Coming in sprint 2/i)).not.toBeInTheDocument();
  });
});
