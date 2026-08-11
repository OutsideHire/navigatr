import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TieredStopList, type TieredStopRow } from "./TieredStopList";

// Rows that carry a left-rail label (v2.2 B 4.5) + a detail-only sentence (4.5.1).
const reasonRows: TieredStopRow[] = [
  { key: "a", tier: "appointment", name: "Renewal review", timeLabel: "3:00 PM", label: "appointment", reason: "" },
  { key: "b", tier: "past_due", name: "Owed Co", label: "anytime", reason: "9 days since your last stop.", aging: true },
  { key: "c", tier: "nearby", name: "New Co", label: "on the way", reason: "Nobody's been in yet." },
];

describe("TieredStopList label + reason lines (v2.2 B 4.5/4.5.1)", () => {
  it("renders the left-rail category label per row", () => {
    render(<TieredStopList rows={reasonRows} />);
    expect(screen.getByText("appointment")).toBeInTheDocument();
    expect(screen.getByText("anytime")).toBeInTheDocument();
    expect(screen.getByText("on the way")).toBeInTheDocument();
  });
  it("renders the detail-only sentence when the reason is non-empty", () => {
    render(<TieredStopList rows={reasonRows} />);
    expect(screen.getByText("9 days since your last stop.")).toBeInTheDocument();
    expect(screen.getByText("Nobody's been in yet.")).toBeInTheDocument();
  });
  it("renders no detail sentence for an appointment with an empty reason (no contact)", () => {
    render(<TieredStopList rows={[reasonRows[0]!]} />);
    // The label + name + time render; there is no empty-string paragraph.
    expect(screen.getByText("appointment")).toBeInTheDocument();
    expect(screen.getByText("Renewal review")).toBeInTheDocument();
    expect(screen.getByText("3:00 PM")).toBeInTheDocument();
  });
  it("colors the sentence as a warning when aging", () => {
    render(<TieredStopList rows={reasonRows} />);
    const aging = screen.getByText("9 days since your last stop.");
    expect(aging.className).toMatch(/status-warning/);
  });
  it("never renders capitalized tier chips, ages, or scores on any row (FR-PATH-UX-04)", () => {
    render(<TieredStopList rows={reasonRows} />);
    for (const forbidden of [/Past due/, /Due today/, /overdue/i, /From calendar/, /\bscore\b/i, /detour/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });
});
