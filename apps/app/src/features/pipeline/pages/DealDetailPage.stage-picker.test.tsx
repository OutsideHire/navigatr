// Integration coverage for the hero StagePicker → StageUpdateModal flow.
//
// Clicking the hero stage badge reveals a navigatr Select (Radix). Picking a
// non-lost stage opens the StageUpdateModal, where confirming persists the
// stage + probability via useUpdateDeal. We mock useDeal/useActivities (same
// shape as DealDetailPage.latest-activity.test.tsx) and additionally mock
// useUpdateDeal to expose a mutateAsync spy we can assert on.
//
// The navigatr Select is a Radix Select rendered through a portal. Radix
// needs a few DOM APIs jsdom doesn't implement (PointerEvent capture,
// scrollIntoView). We polyfill those below so the trigger + items are
// driveable with userEvent. No component code is changed for the test.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_DEALS, type Deal } from "../mockData";
import type { Activity } from "@/features/activities/mockData";

// ── Radix Select jsdom polyfills ───────────────────────────────────────────
beforeAll(() => {
  // Radix Select trigger uses Pointer Capture; jsdom lacks these.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// ── Deal under test: stage "new" ─────────────────────────────────────────────
const newDeal: Deal = { ...MOCK_DEALS[0], stage: "new", probability: 20 };

vi.mock("../hooks/useDeal", () => ({
  useDeal: () => ({ deal: newDeal, isLoading: false }),
}));

vi.mock("@/features/activities/hooks/useActivities", () => ({
  useActivities: (): { data: Activity[] } => ({ data: [] }),
}));

// Module-level spy so the test can assert on calls.
const mutateAsyncSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useUpdateDeal", () => ({
  useUpdateDeal: () => ({ mutateAsync: mutateAsyncSpy, isPending: false }),
}));

// Import after mocks are registered.
import { DealDetailPage } from "./DealDetailPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/pipeline/${newDeal.id}`]}>
        <Routes>
          <Route path="/pipeline/:dealId" element={<DealDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DealDetailPage / StagePicker → StageUpdateModal", () => {
  beforeEach(() => {
    mutateAsyncSpy.mockClear();
  });

  it("badge → Select → modal → confirm persists stage + probability", async () => {
    const user = userEvent.setup();
    renderPage();

    // Hero stage badge: "Stage: New. Click to change."
    const badge = screen.getByRole("button", { name: /Stage: New\. Click to change\./i });
    await user.click(badge);

    // The Select trigger now shows the current value ("New"). Open it.
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);

    // Pick "Qualified".
    const option = await screen.findByRole("option", { name: "Qualified" });
    await user.click(option);

    // StageUpdateModal appears: "Move … to Qualified".
    const modalTitle = await screen.findByText(/Move .* to Qualified/i);
    expect(modalTitle).toBeInTheDocument();

    // Set probability + optional note.
    const probInput = screen.getByLabelText("Probability");
    await user.clear(probInput);
    await user.type(probInput, "60");

    // Confirm.
    const confirm = screen.getByRole("button", { name: /^Move to Qualified$/i });
    await user.click(confirm);

    await waitFor(() => {
      expect(mutateAsyncSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: newDeal.id,
          patch: expect.objectContaining({
            stage: "qualified",
            probability: expect.any(Number),
          }),
        }),
      );
    });
    expect(mutateAsyncSpy.mock.calls[0][0].patch.probability).toBe(60);
  });
});
