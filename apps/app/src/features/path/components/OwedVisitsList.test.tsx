import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OwedVisitsList, type OwedVisitRow } from "./OwedVisitsList";

const row = (o: Partial<OwedVisitRow> = {}): OwedVisitRow => ({
  taskId: "t1",
  dealId: "d1",
  name: "Blue Bottle",
  address: "1 Main St",
  placeId: "gp-blue",
  lat: 37.77,
  lng: -122.41,
  urgency: 1.5,
  bandPosition: "past_ideal",
  dateSource: "interval",
  targetAt: "2026-08-07",
  earliestAt: "2026-08-05",
  latestAt: "2026-08-12",
  snoozeCount: 0,
  sourceOutcome: "not_available",
  createdAt: "2026-08-01T12:00:00.000Z",
  distanceMeters: 1200,
  fits: true,
  ...o,
});

describe("OwedVisitsList", () => {
  it("renders nothing when there are no owed visits", () => {
    const { container } = render(<OwedVisitsList visits={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the group header, the name, the band badge, and the de-snaked outcome", () => {
    render(<OwedVisitsList visits={[row()]} onSelect={vi.fn()} />);
    expect(screen.getByText("Owed visits")).toBeInTheDocument();
    expect(screen.getByText("Blue Bottle")).toBeInTheDocument();
    expect(screen.getByText("Past ideal")).toBeInTheDocument(); // past_ideal
    expect(screen.getByText(/from not available/)).toBeInTheDocument();
  });

  it("shows the unfit label only on rows that won't fit before the next meeting", () => {
    render(
      <OwedVisitsList
        visits={[row({ taskId: "fits", name: "Fits", fits: true }), row({ taskId: "nofit", name: "NoFit", fits: false })]}
        unfitLabel="won't fit before 12:00 PM"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/won't fit before 12:00 PM/)).toBeInTheDocument();
  });

  it("fires onSelect with the visit when a row is tapped", () => {
    const onSelect = vi.fn();
    render(<OwedVisitsList visits={[row()]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Blue Bottle"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", dealId: "d1" }));
  });

  it("puts unfit visits in a 'Couldn't fit today' group with a Snooze button", () => {
    const onSnooze = vi.fn();
    render(
      <OwedVisitsList
        visits={[row({ taskId: "nofit", name: "NoFit", fits: false })]}
        unfitLabel="won't fit before 12:00 PM"
        onSelect={vi.fn()}
        onSnooze={onSnooze}
      />,
    );
    expect(screen.getByText(/Couldn't fit today/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Snooze/i }));
    expect(onSnooze).toHaveBeenCalledWith(expect.objectContaining({ taskId: "nofit" }));
  });

  it("does not fire onSelect when the Snooze button is clicked (click doesn't bubble)", () => {
    const onSelect = vi.fn();
    const onSnooze = vi.fn();
    render(
      <OwedVisitsList visits={[row({ fits: false })]} onSelect={onSelect} onSnooze={onSnooze} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Snooze/i }));
    expect(onSnooze).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
