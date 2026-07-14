// EditPartnerSheet — seed-on-open, dirty-fields-only patch, phone
// normalization, and error handling. useUpdatePartner is mocked as a
// capturable spy so we assert the exact patch that would hit Supabase.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EditPartnerSheet } from "./EditPartnerSheet";
import type { Partner } from "../mockData";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useUpdatePartner", () => ({
  useUpdatePartner: () => ({ mutateAsync, isPending: false }),
}));

// sonner toasts are side-effects we don't assert here; stub to no-ops.
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeAll(() => {
  // Radix Dialog + Select touch these; jsdom lacks them.
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => mutateAsync.mockClear());

function partner(overrides: Partial<Partner> = {}): Partner {
  return {
    id: "p-1",
    name: "Sarah Johnson",
    company: "Johnson & Boyle CPAs",
    type: "cpa",
    status: "active",
    phone: "+12025550101",
    email: "sarah@jbcpa.com",
    city: "Austin, TX",
    lastTouch: null,
    nextFollowup: null,
    attributedDealIds: [],
    outboundDealIds: [],
    notes: "Best CPA in network",
    createdBy: "creator-9",
    ...overrides,
  };
}

function renderSheet(p: Partner = partner()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditPartnerSheet open onOpenChange={() => {}} partner={p} />
    </QueryClientProvider>,
  );
}

describe("EditPartnerSheet", () => {
  it("pre-fills fields from the partner (phone shown as 10-digit, not E.164)", () => {
    renderSheet();
    // Required-field labels render with a trailing "*" (required indicator),
    // so match them by anchored regex; optional fields match exactly.
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Sarah Johnson");
    expect((screen.getByLabelText(/^Company/) as HTMLInputElement).value).toBe("Johnson & Boyle CPAs");
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe("sarah@jbcpa.com");
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Austin, TX");
    expect((screen.getByLabelText(/^Phone/) as HTMLInputElement).value).toBe("(202) 555-0101");
  });

  it("saving with no changes does not call the mutation", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    // Give the submit handler a tick; assert the mutation never fired.
    await waitFor(() => expect(screen.getByRole("button", { name: /Save changes/i })).toBeTruthy());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("patches only the changed field (city)", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Dallas, TX" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ id: "p-1", patch: { city: "Dallas, TX" } });
  });

  it("normalizes a changed phone to E.164", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "(512) 555-2222" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.phone).toBe("+15125552222");
    expect(Object.keys(patch)).toEqual(["phone"]);
  });

  it("includes status when the status select changes", async () => {
    renderSheet();
    // Radix Select: open the status combobox, choose "Cooling".
    const statusTrigger = screen.getByLabelText("Status");
    fireEvent.click(statusTrigger);
    fireEvent.click(screen.getByRole("option", { name: "Cooling" }));
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const [{ patch }] = mutateAsync.mock.calls[0];
    expect(patch.status).toBe("cooling");
  });

  it("keeps the sheet open and does not throw when the mutation rejects", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("permission denied"));
    const onOpenChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EditPartnerSheet open onOpenChange={onOpenChange} partner={partner()} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Reno, NV" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    // On rejection the handler catches + toasts; it must NOT close the sheet.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
