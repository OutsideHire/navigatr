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

import type { QueueSubmission } from "../hooks/useFormSubmissionQueue";

let submissions: QueueSubmission[] | undefined;
vi.mock("../hooks/useFormSubmissionQueue", () => ({ useFormSubmissionQueue: () => ({ data: submissions }) }));
vi.mock("./ReviewFormSubmissionSheet", () => ({
  ReviewFormSubmissionSheet: ({ submission, open }: { submission: QueueSubmission | null; open: boolean }) =>
    open ? <div data-testid="submission-sheet">{submission?.companyName}</div> : null,
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

function sub(id: string, companyName: string, submittedAt: string, linkType: "user" | "tenant", assignedUserId: string | null): QueueSubmission {
  return {
    id, linkType, assignedUserId, companyName, contactName: null, contactEmail: null, contactPhone: null,
    notes: null, referredByText: null, referrerEmail: null, submittedAt,
  };
}

function q(id: string, partnerId: string, companyName: string): QueueReferral {
  return {
    id, partnerId, partnerName: "Jane", partnerCompany: "Jane & Co", companyName,
    contactName: null, contactEmail: null, contactPhone: null, address: null, placeId: null,
    notes: "", submittedAt: "2026-10-07T12:00:00Z", assignedUserId: null,
  };
}

beforeEach(() => { queue = undefined; submissions = undefined; });

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

  it("lists form submissions with referrals, oldest first, labelled by where they came from", () => {
    queue = [q("r-1", "p-1", "Fresh Bakery")]; // 2026-10-07
    submissions = [
      sub("s-1", "Corner Cafe", "2026-10-06T12:00:00Z", "user", "user-1"),
      sub("s-2", "Bolt Gym", "2026-10-08T12:00:00Z", "tenant", null),
      sub("s-3", "Desk Co", "2026-10-09T12:00:00Z", "user", "user-2"),
    ];
    render(<ReferralQueueCard />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Review / }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Review Corner Cafe", "Review Fresh Bakery", "Review Bolt Gym", "Review Desk Co",
    ]);
    expect(screen.getByText("From your referral form")).toBeInTheDocument();
    expect(screen.getByText("From the company form")).toBeInTheDocument();
    expect(screen.getByText("From a rep's referral form")).toBeInTheDocument();
    expect(screen.getByText("From Jane")).toBeInTheDocument();
  });

  it("a partner's page never lists form submissions", () => {
    queue = [];
    submissions = [sub("s-1", "Corner Cafe", "2026-10-06T12:00:00Z", "user", "user-1")];
    const { container } = render(<ReferralQueueCard partnerId="p-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the submission sheet for the clicked submission", () => {
    submissions = [sub("s-1", "Corner Cafe", "2026-10-06T12:00:00Z", "user", "user-1")];
    render(<ReferralQueueCard />);
    fireEvent.click(screen.getByRole("button", { name: "Review Corner Cafe" }));
    expect(screen.getByTestId("submission-sheet")).toHaveTextContent("Corner Cafe");
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("keeps an open sheet when the queue empties under it", () => {
    submissions = [sub("s-1", "Corner Cafe", "2026-10-06T12:00:00Z", "user", "user-1")];
    const { rerender } = render(<ReferralQueueCard />);
    fireEvent.click(screen.getByRole("button", { name: "Review Corner Cafe" }));
    submissions = [];
    rerender(<ReferralQueueCard />);
    expect(screen.getByTestId("submission-sheet")).toHaveTextContent("Corner Cafe");
    expect(screen.queryByText("Referrals to review")).toBeNull();
  });
});
