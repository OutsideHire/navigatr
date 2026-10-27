// FR-PORT-35 (Q10): the Edit Deal employee-count picker uses the same four
// buckets as the partner referral forms, so a referral's size round-trips.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditDealSheet } from "./EditDealSheet";
import type { Deal } from "../mockData";

vi.mock("../hooks/useUpdateDeal", () => ({
  useUpdateDeal: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
}));
vi.mock("../hooks/useDeleteDeal", () => ({
  useDeleteDeal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { role: "rep", org_id: "org-1" } }),
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

function renderSheet(employeeCountRange: string) {
  const deal: Deal = {
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
    employeeCountRange,
    leadSource: "inbound",
    updatedAt: "2026-07-01T12:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditDealSheet open onOpenChange={() => {}} deal={deal} />
    </QueryClientProvider>,
  );
}

describe("EditDealSheet: employee count", () => {
  it("offers the four referral-form buckets", async () => {
    renderSheet("");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Employee count" }), { key: "Enter" });
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["1 to 10", "11 to 50", "51 to 200", "Over 200"]);
  });

  it("shows a stored bucket by its label", () => {
    renderSheet("51-200");
    expect(screen.getByRole("combobox", { name: "Employee count" })).toHaveTextContent("51 to 200");
  });
});
