// Coverage for DealContactSheet (Deal Contacts tab, Task 2).
//
// Radix Dialog/Select need a few DOM APIs jsdom lacks; we polyfill them in
// beforeAll (mirrors PipelineFilterPopover.test.tsx / SendReferralSheet.test.tsx).
// The create/update hooks are mocked so we can capture mutate args.

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DealContactSheet } from "./DealContactSheet";
import type { DealContact } from "../hooks/useDealContacts";

// ── Radix jsdom polyfills ──────────────────────────────────────────────────
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  }
});

const createMutateAsync = vi.fn().mockResolvedValue({ id: "c1" });
const updateMutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useDealContacts", () => ({
  useCreateDealContact: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateDealContact: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

function renderSheet(props: Partial<React.ComponentProps<typeof DealContactSheet>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DealContactSheet open onOpenChange={vi.fn()} dealId="d1" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createMutateAsync.mockClear();
  updateMutateAsync.mockClear();
});

describe("DealContactSheet", () => {
  it("disables the submit button when name is blank", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: /add contact/i })).toBeDisabled();
  });

  it("typing a name + submitting calls createMutateAsync with dealId + name", async () => {
    renderSheet({ dealId: "d1" });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Pat Buyer" } });
    fireEvent.click(screen.getByRole("button", { name: /add contact/i }));
    await vi.waitFor(() =>
      expect(createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ dealId: "d1", name: "Pat Buyer" }),
      ),
    );
  });

  it("in edit mode prefills the name and submitting calls updateMutateAsync", async () => {
    const contact: DealContact = {
      id: "c9", dealId: "d1", name: "Existing Contact", title: "VP",
      email: "vp@co.com", phone: "+15551234567", role: "champion",
      note: "n", createdAt: "2026-01-01T00:00:00Z",
    };
    renderSheet({ contact });
    expect(screen.getByLabelText(/name/i)).toHaveValue("Existing Contact");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: "c9" }),
      ),
    );
  });
});
