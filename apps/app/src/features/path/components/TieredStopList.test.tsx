import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TieredStopList, type TieredStopRow } from "./TieredStopList";

// Rows that carry a reason line (the new path).
const reasonRows: TieredStopRow[] = [
  { key: "a", tier: "appointment", name: "Renewal review", timeLabel: "3:00 PM", reason: "You have a 3:00 PM here." },
  { key: "b", tier: "past_due", name: "Owed Co", reason: "You have not stopped by in 9 days.", aging: true },
  { key: "c", tier: "nearby", name: "New Co", reason: "New. Nobody has been in." },
];

describe("TieredStopList reason lines", () => {
  it("renders one reason line per row when reason is provided", () => {
    render(<TieredStopList rows={reasonRows} />);
    expect(screen.getByText("You have a 3:00 PM here.")).toBeInTheDocument();
    expect(screen.getByText("You have not stopped by in 9 days.")).toBeInTheDocument();
    expect(screen.getByText("New. Nobody has been in.")).toBeInTheDocument();
  });
  it("suppresses tier chip and overdue-age text on reason rows (FR-PATH-UX-04)", () => {
    render(<TieredStopList rows={reasonRows} />);
    for (const forbidden of [/past due/i, /due today/i, /\bnearby\b/i, /overdue/i, /appointment/i, /from calendar/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });
  it("colors the reason line as a warning when aging", () => {
    render(<TieredStopList rows={reasonRows} />);
    const aging = screen.getByText("You have not stopped by in 9 days.");
    expect(aging.className).toMatch(/status-warning/);
  });
  it("never renders tier chips, ages, or scores on any row (FR-PATH-UX-04)", () => {
    const rows: TieredStopRow[] = [
      { key: "a", tier: "appointment", name: "Appt", timeLabel: "3:00 PM", reason: "You have a 3:00 PM here." },
      { key: "b", tier: "past_due", name: "Owed", reason: "You have not stopped by in 9 days.", aging: true },
      { key: "c", tier: "due_today", name: "Due", reason: "You have not stopped by in 0 days." },
      { key: "d", tier: "nearby", name: "New", reason: "New. Nobody has been in." },
    ];
    render(<TieredStopList rows={rows} />);
    for (const forbidden of [/past due/i, /due today/i, /\bnearby\b/i, /\bappointment\b/i, /overdue/i, /from calendar/i, /\bscore\b/i, /\bmi\b/, /detour/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });
});
