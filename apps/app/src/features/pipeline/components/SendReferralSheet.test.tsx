// Coverage for SendReferralSheet (FR-PIPE-09).
//
// The partner picker is a navigatr Select (Radix Select rendered through a
// portal). Radix needs a few DOM APIs jsdom lacks (PointerEvent capture,
// scrollIntoView); we polyfill them in beforeAll like
// DealDetailPage.stage-picker.test.tsx so the trigger + items are driveable
// with userEvent. We mock useReferDeal/usePartners/sonner.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MOCK_DEALS, type Deal } from "../mockData";
import type { Partner } from "@/features/partners/mockData";

// ── Radix Select jsdom polyfills ───────────────────────────────────────────
beforeAll(() => {
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

// Module-level spy so the test can assert on calls.
const mutateAsyncSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/partners/hooks/useReferDeal", () => ({
  useReferDeal: () => ({ mutateAsync: mutateAsyncSpy, isPending: false }),
}));

// Controllable partner list — default two partners.
let partnersData: Pick<Partner, "id" | "name" | "company">[] = [
  { id: "p1", name: "Sarah", company: "CPA Co" },
  { id: "p2", name: "Bob", company: "Bank" },
];
vi.mock("@/features/partners/hooks/usePartners", () => ({
  usePartners: () => ({ data: partnersData }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Import after mocks are registered.
import { SendReferralSheet } from "./SendReferralSheet";

const deal: Deal = { ...MOCK_DEALS[0] };

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SendReferralSheet open onOpenChange={() => {}} deal={deal} />
    </QueryClientProvider>,
  );
}

describe("SendReferralSheet", () => {
  beforeEach(() => {
    mutateAsyncSpy.mockClear();
    partnersData = [
      { id: "p1", name: "Sarah", company: "CPA Co" },
      { id: "p2", name: "Bob", company: "Bank" },
    ];
  });

  it("picks a partner and sends a referral", async () => {
    const user = userEvent.setup();
    renderSheet();

    // Send disabled until a partner is chosen.
    const send = screen.getByRole("button", { name: /Send referral/i });
    expect(send).toBeDisabled();

    // Open the Radix Select and pick Sarah (p1).
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);
    const option = await screen.findByRole("option", { name: /Sarah · CPA Co/i });
    await user.click(option);

    expect(send).toBeEnabled();
    await user.click(send);

    await waitFor(() => {
      expect(mutateAsyncSpy).toHaveBeenCalledWith(
        expect.objectContaining({ dealId: deal.id, partnerId: "p1" }),
      );
    });
  });

  it("shows the empty hint and disables send when there are no partners", () => {
    partnersData = [];
    renderSheet();

    expect(screen.getByText(/No partners yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send referral/i })).toBeDisabled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
