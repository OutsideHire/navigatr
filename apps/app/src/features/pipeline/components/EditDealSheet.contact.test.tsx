// QA regression: editing contact email/phone on a deal must persist.
//
// Reported: editing the contact email does not save, and the contact phone
// cannot be edited at all. This exercises the Edit Deal form end to end:
// type a new email / phone, hit Save, and assert the update mutation is
// called with the changed contactEmail and E.164 contactPhone.
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
    nextFollowup: null,
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

// Re-render helper that swaps in a FRESH `deal` object with identical data
// (new reference), the exact shape a React Query background refetch takes,
// since useDeal derives the deal via deals.find() on a rebuilt array.
function renderSheetWithRefetch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <EditDealSheet open onOpenChange={() => {}} deal={deal()} />
    </QueryClientProvider>,
  );
  const refetch = () =>
    utils.rerender(
      <QueryClientProvider client={client}>
        <EditDealSheet open onOpenChange={() => {}} deal={deal()} />
      </QueryClientProvider>,
    );
  return { ...utils, refetch };
}

describe("EditDealSheet: contact email and phone persist", () => {
  it("saves an edited email", async () => {
    renderSheet();

    const email = document.getElementById("contactEmail") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "new@acme.com" } });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.contactEmail).toBe("new@acme.com");
  });

  it("saves an edited phone in E.164", async () => {
    renderSheet();

    const phone = document.getElementById("contactPhone") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "3105551234" } });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.contactPhone).toBe("+13105551234");
  });

  it("keeps an in-progress email edit through a background refetch, then saves it", async () => {
    const { refetch } = renderSheetWithRefetch();

    const email = document.getElementById("contactEmail") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "new@acme.com" } });

    // A React Query refetch hands EditDealSheet a fresh `deal` reference.
    // The form must NOT re-seed and discard the rep's typed value.
    refetch();

    const emailAfter = document.getElementById("contactEmail") as HTMLInputElement;
    expect(emailAfter.value).toBe("new@acme.com");

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.contactEmail).toBe("new@acme.com");
  });

  it("keeps an in-progress phone edit through a background refetch, then saves it", async () => {
    const { refetch } = renderSheetWithRefetch();

    const phone = document.getElementById("contactPhone") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "3105551234" } });

    refetch();

    const phoneAfter = document.getElementById("contactPhone") as HTMLInputElement;
    expect(phoneAfter.value).toBe("(310) 555-1234");

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.contactPhone).toBe("+13105551234");
  });
});
