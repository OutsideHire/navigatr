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
});
