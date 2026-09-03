// Prospect capture: a rep adding a business (esp. via Google search) should NOT
// be forced to fill contact name, phone, or deal value. Empty fields persist as
// DB-safe blanks (contact "" and value 0 satisfy the not-null columns) so the
// rep can qualify the deal later via the Edit form. Lead source is the ONE thing
// still required: a search-added deal auto-stamps "places", and a manual deal
// makes the rep pick a source (Robert, 2026-09-03 QA: don't drop lead source).
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("AddDealSheet: prospect capture (contact fields optional, lead source still required)", () => {
  it("adds a manual prospect with only company + lead source: contact/phone blank, value $0", async () => {
    const user = userEvent.setup();
    renderSheet();
    fireEvent.change(document.getElementById("companyName") as HTMLInputElement, {
      target: { value: "Sunset Cafe" },
    });
    // Lead source is required even for a prospect: a manual deal must pick one.
    await user.click(document.getElementById("leadSource") as HTMLElement);
    await user.click(await screen.findByRole("option", { name: /Inbound/i }));

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [payload] = mutateAsync.mock.calls[0];
    expect(payload.companyName).toBe("Sunset Cafe");
    expect(payload.contactName).toBe("");
    expect(payload.contactPhone).toBe("");
    expect(payload.valueCents).toBe(0);
    expect(payload.leadSource).toBe("inbound");
  });

  it("still requires a lead source on a manual deal (blocked with only a company name)", async () => {
    renderSheet();
    fireEvent.change(document.getElementById("companyName") as HTMLInputElement, {
      target: { value: "Sunset Cafe" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add deal/i }));

    expect(await screen.findByText(/Pick a lead source/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("still rejects a partially-typed phone (must be 10 digits when provided)", async () => {
    const user = userEvent.setup();
    renderSheet();
    fireEvent.change(document.getElementById("companyName") as HTMLInputElement, {
      target: { value: "Sunset Cafe" },
    });
    // Pick a lead source so the only remaining error isolates the phone.
    await user.click(document.getElementById("leadSource") as HTMLElement);
    await user.click(await screen.findByRole("option", { name: /Inbound/i }));
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
