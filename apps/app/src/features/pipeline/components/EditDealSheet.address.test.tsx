// Address field on the deal Edit form. Previously the field was missing
// entirely, so reps could not add/edit a deal's address (the reported bug).
// Covers: the field renders + prefills from the deal, a change is saved as
// patch.address, and emptying it clears to null. The re-geocode that
// useUpdateDeal fires on an address change is covered in its own test.
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

function deal(over: Partial<Deal> = {}): Deal {
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
    nextFollowup: null,
    address: null,
    employeeCountRange: "10-49",
    leadSource: "inbound",
    updatedAt: "2026-07-01T12:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
    ...over,
  };
}

function renderSheet(d: Deal) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditDealSheet open onOpenChange={() => {}} deal={d} />
    </QueryClientProvider>,
  );
}

describe("EditDealSheet — address field", () => {
  it("renders the Address field prefilled from the deal", () => {
    renderSheet(deal({ address: "123 Main St, Springfield" }));
    const input = screen.getByLabelText("Address") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("123 Main St, Springfield");
  });

  it("saves a changed address as patch.address", async () => {
    renderSheet(deal({ address: "123 Main St" }));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "456 Oak Ave" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.address).toBe("456 Oak Ave");
  });

  it("clears the address to null when emptied", async () => {
    renderSheet(deal({ address: "123 Main St" }));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.address).toBeNull();
  });

  it("does NOT save (or re-geocode) a whitespace-only address edit", async () => {
    renderSheet(deal({ address: "123 Main St" }));
    // Trailing space: the raw value looks dirty but the trimmed value is unchanged.
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "123 Main St " } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    // Address was the only edit and it collapses to no change, so nothing saves.
    await new Promise((r) => setTimeout(r, 0));
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
