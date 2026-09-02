// Prospect round-trip: a deal captured as a bare PROSPECT (no contact, no phone,
// $0 value) must be openable + progressable in the Edit form without the rep
// being forced to invent a contact name, phone, or deal value. This is the
// other half of the "remove required fields when adding a deal" change: adding a
// prospect is pointless if editing it then hard-requires the same fields.
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

// A bare prospect, exactly as AddDealSheet persists one: company name only,
// contact "", phone "", email "", value 0.
function prospect(): Deal {
  return {
    id: "d-prospect",
    companyName: "Sunset Cafe",
    contactName: "",
    phone: "",
    email: "",
    valueCents: 0,
    stage: "new",
    probability: 10,
    lastActivity: "2026-09-01T12:00:00Z",
    nextFollowup: null,
    address: null,
    employeeCountRange: "10-49",
    leadSource: "places",
    updatedAt: "2026-09-01T12:00:00Z",
    owner_id: null,
    lostReasonCategory: null,
    lostReasonNotes: null,
  };
}

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditDealSheet open onOpenChange={() => {}} deal={prospect()} />
    </QueryClientProvider>,
  );
}

describe("EditDealSheet: a bare prospect stays editable (no required contact/phone/value)", () => {
  it("saves a change without inventing a contact name, phone, or deal value", async () => {
    renderSheet();

    // Only the company name changes; contact/phone/value stay blank. If any of
    // those were still hard-required, the submit would be blocked here.
    const company = document.getElementById("companyName") as HTMLInputElement;
    fireEvent.change(company, { target: { value: "Sunset Cafe & Bakery" } });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.companyName).toBe("Sunset Cafe & Bakery");
    // Untouched blank fields are not patched (they stay their DB-safe blanks).
    expect(patch.contactPhone).toBeUndefined();
    expect(patch.valueCents).toBeUndefined();
    expect(patch.contactName).toBeUndefined();
  });

  it("drops the required affordance on Contact name / Phone / Deal value", () => {
    renderSheet();
    for (const id of ["contactName", "contactPhone", "dealValue"]) {
      const label = document.querySelector(`label[for="${id}"]`) as HTMLLabelElement | null;
      expect(label).not.toBeNull();
      expect(label!.textContent).not.toContain("*");
      expect(label!.querySelector('[title="Required"]')).toBeNull();
    }
  });

  it("lets the rep qualify the prospect later: a typed phone saves as E.164", async () => {
    renderSheet();

    const phone = document.getElementById("contactPhone") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "3105551234" } });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.contactPhone).toBe("+13105551234");
  });

  it("lets the rep qualify the prospect later: a typed value saves in cents", async () => {
    renderSheet();

    const value = document.getElementById("dealValue") as HTMLInputElement;
    fireEvent.change(value, { target: { value: "2500" } });

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.valueCents).toBe(250_000);
  });

  it("still rejects a partially-typed phone (must be 10 digits when provided)", async () => {
    renderSheet();

    const phone = document.getElementById("contactPhone") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "310555" } }); // < 10 digits

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    expect(await screen.findByText(/10-digit US phone/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
