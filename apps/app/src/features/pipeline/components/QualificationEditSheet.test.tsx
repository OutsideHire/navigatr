import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QualificationEditSheet } from "./QualificationEditSheet";
import { MOCK_DEALS, type Deal } from "../mockData";

const mutateAsyncSpy = vi.fn().mockResolvedValue({});

vi.mock("../hooks/useUpdateDeal", () => ({
  useUpdateDeal: () => ({ mutateAsync: mutateAsyncSpy, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function deal(over: Partial<Deal> = {}): Deal {
  return {
    ...MOCK_DEALS[0],
    professionData: {
      profession: "merchant_services",
      annualVolume: 500000,
      acceptanceMethods: ["card_present"],
      currentProcessor: "Square",
      currentEffectiveRate: 2.6,
      posTerminal: "Clover",
      avgTicketSize: 45,
    },
    ...over,
  };
}

describe("QualificationEditSheet", () => {
  beforeEach(() => {
    mutateAsyncSpy.mockClear();
  });

  it("seeds fields and saves the edited processor", async () => {
    const d = deal();
    render(<QualificationEditSheet open deal={d} onOpenChange={vi.fn()} />);

    const processor = screen.getByLabelText(/current processor/i) as HTMLInputElement;
    expect(processor.value).toBe("Square");

    fireEvent.change(processor, { target: { value: "Stripe" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mutateAsyncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: d.id,
        patch: expect.objectContaining({
          professionData: expect.objectContaining({
            profession: "merchant_services",
            currentProcessor: "Stripe",
          }),
        }),
      }),
    );
  });

  it("toggles acceptance methods on save (add + remove branches)", async () => {
    // deal() seeds acceptanceMethods = ["card_present"] (no "ecommerce")
    const d = deal();
    render(<QualificationEditSheet open deal={d} onOpenChange={vi.fn()} />);

    // add: check an unchecked method
    fireEvent.click(screen.getByLabelText(/e-commerce/i));
    // remove: uncheck the seeded one
    fireEvent.click(screen.getByLabelText(/card present/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    const patch = mutateAsyncSpy.mock.calls[0][0].patch.professionData.acceptanceMethods;
    expect(patch).toContain("ecommerce");
    expect(patch).not.toContain("card_present");
  });
});
