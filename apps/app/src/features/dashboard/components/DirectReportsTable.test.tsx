import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DirectReportsTable } from "./DirectReportsTable";
import type { DirectReportInput } from "../lib/directReports";

const rep = (over: Partial<DirectReportInput> = {}): DirectReportInput => ({
  ownerId: "u1",
  name: "Rep One",
  role: "Sales Professional",
  composite: 70,
  delta30: 0,
  activityCount: 100,
  spark: [68, 69, 70],
  ...over,
});

const sample: DirectReportInput[] = [
  rep({ ownerId: "jamal", name: "Jamal Brooks", composite: 58, delta30: -6.3, activityCount: 158 }), // needs_attention
  rep({ ownerId: "tyler", name: "Tyler Osei", composite: 66, delta30: 4.5, activityCount: 231 }), // trending_up
  rep({ ownerId: "priya", name: "Priya Raghavan", composite: 84, delta30: -0.2, activityCount: 318 }), // holding
];

describe("DirectReportsTable", () => {
  it("renders a row per rep, sorted by index descending", () => {
    render(<DirectReportsTable rows={sample} onSelect={vi.fn()} />);
    const rows = screen.getAllByTestId("direct-report-row");
    expect(rows).toHaveLength(3);
    // Highest index first: Priya (84) > Tyler (66) > Jamal (58).
    expect(within(rows[0]).getByText("Priya Raghavan")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Jamal Brooks")).toBeInTheDocument();
  });

  it("shows the status badge for each rep", () => {
    render(<DirectReportsTable rows={sample} onSelect={vi.fn()} />);
    // Scope to rows so we match badges, not the same-text filter pills.
    const rows = screen.getAllByTestId("direct-report-row");
    expect(within(rows[0]).getByText("Holding")).toBeInTheDocument(); // Priya (84)
    expect(within(rows[1]).getByText("Trending up")).toBeInTheDocument(); // Tyler (66)
    expect(within(rows[2]).getByText("Needs attention")).toBeInTheDocument(); // Jamal (58)
  });

  it("filters rows when a status pill is chosen", () => {
    render(<DirectReportsTable rows={sample} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Needs attention" }));
    const rows = screen.getAllByTestId("direct-report-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Jamal Brooks")).toBeInTheDocument();
  });

  it("calls onSelect with the rep id when a row is clicked", () => {
    const onSelect = vi.fn();
    render(<DirectReportsTable rows={sample} onSelect={onSelect} />);
    fireEvent.click(within(screen.getAllByTestId("direct-report-row")[0]).getByText("Priya Raghavan"));
    expect(onSelect).toHaveBeenCalledWith("priya");
  });

  it("renders an Export CSV control", () => {
    render(<DirectReportsTable rows={sample} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /export csv/i })).toBeInTheDocument();
  });

  it("renders nothing when there are no reps", () => {
    const { container } = render(<DirectReportsTable rows={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
