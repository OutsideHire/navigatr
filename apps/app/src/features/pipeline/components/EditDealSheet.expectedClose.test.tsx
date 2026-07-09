// Bug B regression — expected-close stored as a calendar date.
//
// The Expected close field is a YYYY-MM-DD <input type="date">. Pre-fix the
// sheet mirrored it to next_followup_at via `new Date(value).toISOString()`,
// which parses YYYY-MM-DD as UTC midnight — so cards/hero rendered it a day
// early for reps west of UTC. The fix stores noon UTC of the picked day. This
// asserts the stored instant, so it fails on the pre-fix code (T00:00) and
// passes after (T12:00) regardless of the runner's timezone.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditDealSheet } from "./EditDealSheet";
import type { Deal } from "../mockData";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useUpdateDeal", () => ({
  useUpdateDeal: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("../hooks/useDeleteDeal", () => ({
  useDeleteDeal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role: "rep", org_id: "org-1" } }),
}));

beforeAll(() => {
  // Radix Dialog touches these; jsdom lacks them.
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => mutateAsync.mockClear());

function deal(): Deal {
  return {
    id: "d-1",
    companyName: "Acme",
    contactName: "Jane Doe",
    phone: "+12025550100",
    email: "jane@acme.com",
    valueCents: 500_000,
    stage: "contacted",
    probability: 40,
    lastActivity: "2026-07-01T12:00:00Z",
    nextFollowup: null, // expectedClose default is ""
    address: null,
    employeeCountRange: "10-49",
    leadSource: "inbound",
    updatedAt: "2026-07-01T12:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
}

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditDealSheet open onOpenChange={() => {}} deal={deal()} />
    </QueryClientProvider>,
  );
}

describe("EditDealSheet — expected close is stored as a calendar date", () => {
  it("mirrors the picked date to next_followup_at at NOON UTC (not UTC midnight)", async () => {
    renderSheet();

    const input = screen.getByLabelText("Expected close") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-07-09" } });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.expectedClose).toBe("2026-07-09");
    expect(patch.nextFollowupAt).toBe("2026-07-09T12:00:00.000Z");
  });
});
