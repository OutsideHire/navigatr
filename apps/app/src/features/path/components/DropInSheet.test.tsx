// Tests for DropInSheet (Path v2, Slice 3):
//   - Engaged disposition (met_dm): Save creates a deal + logs the drop-in
//     activity, records the visit on the path, and marks the deal created.
//   - Non-engaged disposition (not_in_office): Save records the visit only —
//     no deal, no activity.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ───────────────────────────────────────────────────────────
const createDealMutateAsync = vi.fn().mockResolvedValue({ id: "deal-1" });
const logActivityMutateAsync = vi.fn().mockResolvedValue({ id: "act-1" });

vi.mock("@/features/pipeline/hooks/useCreateDeal", () => ({
  useCreateDeal: () => ({ mutateAsync: createDealMutateAsync }),
}));

vi.mock("@/features/activities/hooks/useLogActivity", () => ({
  useLogActivity: () => ({ mutateAsync: logActivityMutateAsync }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const logVisit = vi.fn();
const markDealCreated = vi.fn();
vi.mock("../hooks/useTodayPath", () => ({
  useTodayPath: () => ({ logVisit, markDealCreated }),
}));

const { DropInSheet } = await import("./DropInSheet");
import type { Merchant } from "../mockData";

const merchant: Merchant = {
  id: "m-1",
  name: "Joe's Diner",
  category: "food_beverage",
  address: "123 Main St",
  lat: 40,
  lng: -74,
  phone: "+15551234567",
  employeeCountRange: "1-10",
  status: "untouched",
  lastActivity: null,
};

describe("DropInSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDealMutateAsync.mockResolvedValue({ id: "deal-1" });
    logActivityMutateAsync.mockResolvedValue({ id: "act-1" });
    logVisit.mockClear();
    markDealCreated.mockClear();
  });

  it("engaged disposition creates a deal, logs the activity, records the visit, and marks the deal created", async () => {
    const user = userEvent.setup();
    render(<DropInSheet merchant={merchant} open onOpenChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /met with decision maker/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(createDealMutateAsync).toHaveBeenCalledTimes(1));

    const dealPayload = createDealMutateAsync.mock.calls[0][0];
    expect(dealPayload).toMatchObject({
      companyName: "Joe's Diner",
      leadSource: "path_dropin",
    });
    expect(dealPayload).not.toHaveProperty("contactEmail");
    expect(dealPayload).not.toHaveProperty("valueCents");

    expect(logActivityMutateAsync).toHaveBeenCalledTimes(1);
    const activityPayload = logActivityMutateAsync.mock.calls[0][0];
    expect(activityPayload).toMatchObject({ type: "drop_in", disposition: "met_dm" });
    expect(activityPayload.followUpDate).not.toBeNull();

    // Path side-effects: visit recorded with the disposition + deal marked.
    expect(logVisit).toHaveBeenCalledWith("m-1", "met_dm");
    expect(markDealCreated).toHaveBeenCalledWith("m-1");
  });

  it("non-engaged disposition records the visit only — no deal, no activity, dealCreated stays false", async () => {
    const user = userEvent.setup();
    render(<DropInSheet merchant={merchant} open onOpenChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /not in office/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(logVisit).toHaveBeenCalled());

    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(logActivityMutateAsync).not.toHaveBeenCalled();
    expect(logVisit).toHaveBeenCalledWith("m-1", "not_in_office");
    expect(markDealCreated).not.toHaveBeenCalled();
  });
});
