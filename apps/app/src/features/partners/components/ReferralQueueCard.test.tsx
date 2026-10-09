import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ReferralQueueCard } from "./ReferralQueueCard";
import type { QueueReferral } from "../hooks/useReferralQueue";

let queue: QueueReferral[] | undefined;
vi.mock("../hooks/useReferralQueue", () => ({ useReferralQueue: () => ({ data: queue }) }));
vi.mock("./ReviewReferralSheet", () => ({
  ReviewReferralSheet: ({ referral, open }: { referral: QueueReferral | null; open: boolean }) =>
    open ? <div data-testid="sheet">{referral?.companyName}</div> : null,
}));

function q(id: string, partnerId: string, companyName: string): QueueReferral {
  return {
    id, partnerId, partnerName: "Jane", partnerCompany: "Jane & Co", companyName,
    contactName: null, contactEmail: null, contactPhone: null, address: null, placeId: null,
    notes: "", submittedAt: "2026-10-07T12:00:00Z", assignedUserId: null,
  };
}

beforeEach(() => { queue = undefined; });

describe("ReferralQueueCard", () => {
  it("renders nothing when the queue is empty or loading", () => {
    const { container, rerender } = render(<ReferralQueueCard />);
    expect(container).toBeEmptyDOMElement();
    queue = [];
    rerender(<ReferralQueueCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a count and each referral", () => {
    queue = [q("r-1", "p-1", "Fresh Bakery"), q("r-2", "p-2", "Bolt Gym")];
    render(<ReferralQueueCard />);
    expect(screen.getByText("Referrals to review")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Fresh Bakery")).toBeInTheDocument();
    expect(screen.getByText("Bolt Gym")).toBeInTheDocument();
  });

  it("filters to one partner when partnerId is given", () => {
    queue = [q("r-1", "p-1", "Fresh Bakery"), q("r-2", "p-2", "Bolt Gym")];
    render(<ReferralQueueCard partnerId="p-2" />);
    expect(screen.queryByText("Fresh Bakery")).not.toBeInTheDocument();
    expect(screen.getByText("Bolt Gym")).toBeInTheDocument();
  });

  it("opens the review sheet for the clicked referral", () => {
    queue = [q("r-1", "p-1", "Fresh Bakery")];
    render(<ReferralQueueCard />);
    fireEvent.click(screen.getByRole("button", { name: "Review Fresh Bakery" }));
    expect(screen.getByTestId("sheet")).toHaveTextContent("Fresh Bakery");
  });
});
