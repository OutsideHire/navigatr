// Prospect capture: a rep adding a business (esp. via Google search) should NOT
// be forced to fill contact name, phone, deal value, or lead source. Only the
// company name is required. Empty fields persist as DB-safe blanks (contact ""
// and value 0 satisfy the not-null columns; a blank lead source is sent as
// undefined and useCreateDeal coerces it to "unknown") so the rep can qualify
// the deal later via the Edit form.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AddDealSheet } from "./AddDealSheet";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useCreateDeal", () => ({
  useCreateDeal: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("../hooks/usePlaceResolver", () => ({
  usePlaceResolver: () => ({ autocomplete: vi.fn().mockResolvedValue([]), resolveDetails: vi.fn(), newSession: vi.fn() }),
}));
vi.mock("../hooks/usePlaceDuplicateCheck", () => ({
  usePlaceDuplicateCheck: () => ({ checkPlaceDuplicate: vi.fn().mockResolvedValue(null) }),
}));
vi.mock("../hooks/useAttachPlaceToDeal", () => ({
  useAttachPlaceToDeal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../hooks/useDealSearchBias", () => ({ useDealSearchBias: () => undefined }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "u-1" } }),
  getProfession: () => "merchant_services",
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => mutateAsync.mockClear());

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AddDealSheet open onOpenChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AddDealSheet: prospect capture (required fields dropped)", () => {
  it("adds a prospect with only a company name: contact/phone blank, value $0", async () => {
    renderSheet();
    fireEvent.change(document.getElementById("companyName") as HTMLInputElement, {
      target: { value: "Sunset Cafe" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [payload] = mutateAsync.mock.calls[0];
    expect(payload.companyName).toBe("Sunset Cafe");
    expect(payload.contactName).toBe("");
    expect(payload.contactPhone).toBe("");
    expect(payload.valueCents).toBe(0);
    expect(payload.leadSource).toBeUndefined(); // manual + blank; useCreateDeal coerces to "unknown"
  });

  it("still rejects a partially-typed phone (must be 10 digits when provided)", async () => {
    renderSheet();
    fireEvent.change(document.getElementById("companyName") as HTMLInputElement, {
      target: { value: "Sunset Cafe" },
    });
    fireEvent.change(document.getElementById("contactPhone") as HTMLInputElement, {
      target: { value: "310555" }, // < 10 digits
    });

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    expect(await screen.findByText(/10-digit US phone/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("drops the required affordance on Contact name / Phone / Deal value", () => {
    renderSheet();
    for (const id of ["contactName", "contactPhone", "dealValue"]) {
      const label = document.querySelector(`label[for="${id}"]`) as HTMLLabelElement | null;
      expect(label).not.toBeNull();
      expect(label!.textContent).not.toContain("*");
    }
  });
});
