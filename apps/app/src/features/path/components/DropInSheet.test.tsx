// Tests for DropInSheet (Path v2, Slice 3):
//   - Engaged disposition (met_dm): Save creates a deal + logs the drop-in
//     activity, records the visit on the queue, and marks the deal created.
//   - Non-engaged disposition (not_in_office): Save records the visit only —
//     no deal, no activity, and dealCreated stays false.
//
// We mock the two mutation hooks (useCreateDeal / useLogActivity) and sonner's
// toast, and exercise the real usePathQueue store (clear()'d each test) so the
// logVisit / markDealCreated wiring is verified end-to-end.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// In-memory localStorage so Zustand persist works under the test runtime
// (mirrors usePathQueue.test.ts).
const memoryStore = new Map<string, string>();
const memoryLocalStorage: Storage = {
  get length() {
    return memoryStore.size;
  },
  clear: () => memoryStore.clear(),
  getItem: (key) => memoryStore.get(key) ?? null,
  key: (index) => Array.from(memoryStore.keys())[index] ?? null,
  removeItem: (key) => {
    memoryStore.delete(key);
  },
  setItem: (key, value) => {
    memoryStore.set(key, String(value));
  },
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: memoryLocalStorage,
});

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

const { DropInSheet } = await import("./DropInSheet");
const { usePathQueue } = await import("../hooks/usePathQueue");
import type { Merchant } from "../mockData";

const merchant: Merchant = {
  id: "m-1",
  name: "Joe's Diner",
  category: "restaurant",
  address: "123 Main St",
  lat: 40,
  lng: -74,
  phone: "+15551234567",
  employeeCountRange: "1-10",
  status: "untouched",
  lastActivity: null,
};

function stop(id: string) {
  return usePathQueue.getState().stops.find((s) => s.merchantId === id)!;
}

describe("DropInSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createDealMutateAsync.mockResolvedValue({ id: "deal-1" });
    logActivityMutateAsync.mockResolvedValue({ id: "act-1" });
    usePathQueue.getState().clear();
    usePathQueue.getState().add("m-1");
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

    // Queue side-effects: visit recorded with the disposition + deal marked.
    expect(stop("m-1").status).toBe("visited");
    expect(stop("m-1").disposition).toBe("met_dm");
    expect(stop("m-1").dealCreated).toBe(true);
  });

  it("non-engaged disposition records the visit only — no deal, no activity, dealCreated stays false", async () => {
    const user = userEvent.setup();
    render(<DropInSheet merchant={merchant} open onOpenChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /not in office/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(stop("m-1").status).toBe("visited"));

    expect(createDealMutateAsync).not.toHaveBeenCalled();
    expect(logActivityMutateAsync).not.toHaveBeenCalled();
    expect(stop("m-1").disposition).toBe("not_in_office");
    expect(stop("m-1").dealCreated).toBe(false);
  });
});
