import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReferralHistory, describeHistoryEntry } from "./ReferralHistory";
import type { ReferralHistoryEntry } from "../hooks/useReferralHistory";

const state: { data: ReferralHistoryEntry[] | undefined; isError: boolean } = { data: [], isError: false };
const args: unknown[] = [];
vi.mock("../hooks/useReferralHistory", () => ({
  useReferralHistory: (id: unknown) => { args.push(id); return state; },
}));

const e = (o: Partial<ReferralHistoryEntry>): ReferralHistoryEntry => ({
  id: "h", fromStatus: null, toStatus: "submitted", actorType: "user", actorName: null, note: null,
  createdAt: "2026-10-12T15:00:00Z", ...o,
});

describe("describeHistoryEntry", () => {
  it("words each kind of event", () => {
    expect(describeHistoryEntry(e({}))).toBe("Submitted");
    expect(describeHistoryEntry(e({ fromStatus: "submitted", toStatus: "accepted" }))).toBe("Moved to Accepted");
    expect(describeHistoryEntry(e({ fromStatus: "submitted", toStatus: "declined", note: "Out of area" }))).toBe("Moved to Declined. Out of area");
    expect(describeHistoryEntry(e({ fromStatus: "accepted", toStatus: "accepted", note: "Reassigned to Sam Rep" }))).toBe("Reassigned to Sam Rep");
  });
});

describe("ReferralHistory", () => {
  it("is collapsed until opened, then lists date, event and who", async () => {
    state.data = [
      e({ id: "1", fromStatus: "accepted", toStatus: "accepted", note: "Reassigned to Sam Rep", actorName: "Mia Manager", createdAt: "2026-10-14T15:00:00Z" }),
      e({ id: "2", actorType: "partner" }),
      e({ id: "3", fromStatus: "submitted", toStatus: "accepted", actorType: "system" }),
      e({ id: "4", fromStatus: "accepted", toStatus: "working", actorName: null }),
    ];
    render(<ReferralHistory referralId="r-1" />);
    expect(args.at(-1)).toBe("r-1");
    expect(screen.queryByText("Reassigned to Sam Rep")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(screen.getByText("Reassigned to Sam Rep")).toBeInTheDocument();
    expect(screen.getByText(/Mia Manager/)).toBeInTheDocument();
    expect(screen.getByText(/Oct 14/)).toBeInTheDocument();
    expect(screen.getByText(/Partner/)).toBeInTheDocument();
    expect(screen.getByText(/System/)).toBeInTheDocument();
    expect(screen.getByText(/Your team/)).toBeInTheDocument();
  });

  it("says so when there is nothing yet", async () => {
    state.data = [];
    render(<ReferralHistory referralId="r-1" />);
    await userEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(screen.getByText("No history yet.")).toBeInTheDocument();
  });

  it("says so when it cannot load", async () => {
    state.data = undefined;
    state.isError = true;
    render(<ReferralHistory referralId="r-1" />);
    await userEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(screen.getByText("Couldn't load the history.")).toBeInTheDocument();
    state.isError = false;
  });
});
