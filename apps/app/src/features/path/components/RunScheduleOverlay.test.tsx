import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunScheduleOverlay } from "./RunScheduleOverlay";

describe("RunScheduleOverlay", () => {
  const baseProps = {
    arrive: "2026-07-15T13:15:00.000Z",
    dwellMin: 20,
    currentStopName: "Alpha Co",
    nextMeeting: { title: "Smith Insurance", start: "2026-07-15T14:00:00.000Z", located: true },
    stopsUntilNextMeeting: 1,
    fits: true,
  };

  it("shows the current stop ETA and dwell", () => {
    render(<RunScheduleOverlay {...baseProps} />);
    expect(screen.getByText(/20 min/)).toBeInTheDocument();
    expect(screen.getByText(/arrive/i)).toBeInTheDocument();
  });

  it("shows the next-meeting banner with title and stops-to-go", () => {
    render(<RunScheduleOverlay {...baseProps} />);
    expect(screen.getByText(/Smith Insurance/)).toBeInTheDocument();
    expect(screen.getByText(/1 stop to go/i)).toBeInTheDocument();
  });

  it("shows a fit warning when the stop won't make the meeting", () => {
    render(<RunScheduleOverlay {...baseProps} fits={false} />);
    const warn = screen.getByRole("alert");
    expect(warn.textContent).toMatch(/Alpha Co/);
    expect(warn.textContent).toMatch(/won.t fit/i);
  });

  it("renders nothing when there is no ETA and no meeting", () => {
    const { container } = render(
      <RunScheduleOverlay arrive={null} dwellMin={20} currentStopName="X" nextMeeting={null} stopsUntilNextMeeting={0} fits />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
