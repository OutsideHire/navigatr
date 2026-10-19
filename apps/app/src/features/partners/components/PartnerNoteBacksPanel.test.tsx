import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

let data: unknown = undefined;
vi.mock("../hooks/useReferralPartnerNotes", () => ({
  useDealPartnerNotes: () => ({ data }),
}));

import { PartnerNoteBacksPanel } from "./PartnerNoteBacksPanel";

describe("PartnerNoteBacksPanel", () => {
  it("renders nothing without notes", () => {
    data = [];
    const { container } = render(<PartnerNoteBacksPanel dealId="d-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each partner's notes under their name", () => {
    data = [
      { referralId: "r-1", partnerId: "p-1", partnerName: "Jane CPA", notes: [{ id: "n-2", body: "Demo booked.", createdAt: "2026-10-21T12:00:00Z" }] },
      { referralId: "r-2", partnerId: "p-2", partnerName: null, notes: [{ id: "n-3", body: "Not a fit.", createdAt: "2026-10-22T12:00:00Z" }] },
    ];
    render(<PartnerNoteBacksPanel dealId="d-1" />);
    const jane = screen.getByRole("region", { name: "Notes from Jane CPA" });
    expect(within(jane).getByText("Demo booked.")).toBeInTheDocument();
    expect(within(jane).getByText("Oct 21")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Notes from the partner" })).getByText("Not a fit.")).toBeInTheDocument();
  });
});
