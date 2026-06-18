// Notes & Files tab wiring — Task 3 of the Deal Notes & Files feature.
//
// Asserts the Notes & Files tab now renders the real NotesAndFilesTab
// (Notes composer + section), not the "Coming in sprint 2" placeholder.
//
// useDealNotes / useDealFiles are mocked so no real supabase call fires.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealDetailPage } from "./DealDetailPage";
import { MOCK_DEALS } from "../mockData";
import { DEALS_QUERY_KEY } from "../hooks/useDeals";

vi.mock("../hooks/useDealNotes", () => ({
  useDealNotes: () => ({ data: [], isLoading: false }),
  useCreateDealNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDealNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useDealFiles", () => ({
  useDealFiles: () => ({ data: [], isLoading: false }),
  useUploadDealFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDealFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

describe("DealDetailPage / Notes & Files tab", () => {
  it("renders NotesAndFilesTab (Notes section + Add note), not the placeholder", async () => {
    const user = userEvent.setup();
    renderWithRouter("/pipeline/d-001");

    await user.click(screen.getByRole("tab", { name: /Notes & Files/i }));

    const panel = await screen.findByRole("tabpanel");

    // Notes section header + the Add-note composer affordance.
    expect(within(panel).getByText(/^Notes$/i)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Add note/i })).toBeInTheDocument();
    // The old placeholder must be gone.
    expect(screen.queryByText(/Coming in sprint 2/i)).not.toBeInTheDocument();
  });
});
