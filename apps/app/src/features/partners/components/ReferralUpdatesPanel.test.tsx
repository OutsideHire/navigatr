import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { ReferralUpdatesPanel } from "./ReferralUpdatesPanel";

let updates: Array<{ id: string; body: string; publishedAt: string; authorName: string | null }> | undefined = [];
vi.mock("../hooks/useReferralUpdates", () => ({
  REFERRAL_UPDATE_MAX: 1000,
  useReferralUpdates: () => ({ data: updates }),
  usePublishReferralUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    NotesFieldWithMic: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      <textarea aria-label="Update" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
  };
});

beforeEach(() => {
  updates = [];
});

describe("ReferralUpdatesPanel", () => {
  it("lists what was shared, newest first, with the author or Your team", () => {
    updates = [
      { id: "u-2", body: "Demo booked", publishedAt: "2026-10-13T15:00:00Z", authorName: "Rita Rep" },
      { id: "u-1", body: "Called", publishedAt: "2026-10-12T15:00:00Z", authorName: null },
    ];
    render(<ReferralUpdatesPanel referralId="r-1" partnerLabel="Jane" />);
    const list = screen.getByText("SHARED WITH PARTNER").parentElement as HTMLElement;
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Demo bookedRita Rep · Oct 13",
      "CalledYour team · Oct 12",
    ]);
  });

  it("shows only the button when nothing was shared yet", () => {
    render(<ReferralUpdatesPanel referralId="r-1" partnerLabel="Jane" />);
    expect(screen.queryByText("SHARED WITH PARTNER")).toBeNull();
    expect(screen.getByRole("button", { name: "Share update with partner" })).toBeInTheDocument();
  });

  it("opens the share sheet for this partner", () => {
    render(<ReferralUpdatesPanel referralId="r-1" partnerLabel="Jane" />);
    fireEvent.click(screen.getByRole("button", { name: "Share update with partner" }));
    expect(screen.getByRole("heading", { name: "Share an update with Jane" })).toBeInTheDocument();
  });
});
