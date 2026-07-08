import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PathTimeline } from "./PathTimeline";
import type { ScheduleResult } from "../lib/scheduleDay";

const prospect = {
  kind: "prospect" as const,
  id: "p-1",
  name: "Joe's Diner",
  arrive: "2026-07-03T14:00:00.000Z",
  depart: "2026-07-03T14:20:00.000Z", // 20 min dwell
};

const waypoint = {
  kind: "waypoint" as const,
  id: "wp-1",
  title: "Acme HQ demo",
  start: "2026-07-03T15:00:00.000Z",
  end: "2026-07-03T16:00:00.000Z",
};

const timeblock = {
  kind: "timeblock" as const,
  id: "tb-1",
  title: "1:1 with manager",
  start: "2026-07-03T16:30:00.000Z",
  end: "2026-07-03T17:00:00.000Z",
};

/** Local-tz clock time in the same shape the component renders. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

describe("PathTimeline", () => {
  it("renders a prospect row with name, arrive time, and dwell duration", () => {
    const result: ScheduleResult = {
      timeline: [prospect],
      conflicts: [],
      unscheduledProspectIds: [],
    };
    render(<PathTimeline result={result} />);
    expect(screen.getByText("Joe's Diner")).toBeInTheDocument();
    expect(screen.getByText("20 min")).toBeInTheDocument();
    expect(screen.getByText(clock(prospect.arrive))).toBeInTheDocument();
  });

  it("renders a waypoint row with title, start time, and a meeting label", () => {
    const result: ScheduleResult = {
      timeline: [waypoint],
      conflicts: [],
      unscheduledProspectIds: [],
    };
    render(<PathTimeline result={result} />);
    expect(screen.getByText("Acme HQ demo")).toBeInTheDocument();
    expect(screen.getByText(clock(waypoint.start))).toBeInTheDocument();
    // A "Meeting" tag/label marks it as calendar-owned.
    expect(screen.getByText("Meeting")).toBeInTheDocument();
  });

  it("styles waypoint rows with the calendar purple (accent-violet)", () => {
    const result: ScheduleResult = {
      timeline: [waypoint],
      conflicts: [],
      unscheduledProspectIds: [],
    };
    const { container } = render(<PathTimeline result={result} />);
    // The waypoint row wears the accent-violet palette to read as calendar-owned.
    expect(container.querySelector('[class*="accent-violet"]')).not.toBeNull();
  });

  it("renders a timeblock row with 'Meeting (no location)', faded", () => {
    const result: ScheduleResult = {
      timeline: [timeblock],
      conflicts: [],
      unscheduledProspectIds: [],
    };
    render(<PathTimeline result={result} />);
    expect(screen.getByText("1:1 with manager")).toBeInTheDocument();
    expect(screen.getByText("Meeting (no location)")).toBeInTheDocument();
  });

  it("renders all three entry kinds in timeline order", () => {
    const result: ScheduleResult = {
      timeline: [prospect, waypoint, timeblock],
      conflicts: [],
      unscheduledProspectIds: [],
    };
    render(<PathTimeline result={result} />);
    const text = document.body.textContent ?? "";
    const iProspect = text.indexOf("Joe's Diner");
    const iWaypoint = text.indexOf("Acme HQ demo");
    const iBlock = text.indexOf("1:1 with manager");
    expect(iProspect).toBeGreaterThanOrEqual(0);
    expect(iProspect).toBeLessThan(iWaypoint);
    expect(iWaypoint).toBeLessThan(iBlock);
  });

  it("shows a conflict banner listing both titles and the detail", () => {
    const result: ScheduleResult = {
      timeline: [],
      conflicts: [
        {
          betweenTitles: ["Joe's Diner", "Smith Insurance"],
          detail: "~5min apart, need ~18min to drive",
        },
      ],
      unscheduledProspectIds: [],
    };
    render(<PathTimeline result={result} />);
    // Both titles surface, joined into one readable warning.
    expect(screen.getByText(/Joe's Diner and Smith Insurance/)).toBeInTheDocument();
    expect(screen.getByText(/~5min apart, need ~18min to drive/)).toBeInTheDocument();
  });

  it("shows the unscheduled note with the count", () => {
    const result: ScheduleResult = {
      timeline: [prospect],
      conflicts: [],
      unscheduledProspectIds: ["p-2", "p-3"],
    };
    render(<PathTimeline result={result} />);
    // The count is bold and the rest plain, so match the <p> across boundaries.
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && el.textContent === "2 prospects couldn't fit today.",
      ),
    ).toBeInTheDocument();
  });

  it("singularizes the unscheduled note for one prospect", () => {
    const result: ScheduleResult = {
      timeline: [],
      conflicts: [],
      unscheduledProspectIds: ["p-2"],
    };
    render(<PathTimeline result={result} />);
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && el.textContent === "1 prospect couldn't fit today.",
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing intrusive for a fully empty result", () => {
    const result: ScheduleResult = {
      timeline: [],
      conflicts: [],
      unscheduledProspectIds: [],
    };
    const { container } = render(<PathTimeline result={result} />);
    // No banner, no rows, no note — just nothing (null) or an empty container.
    expect(container.textContent?.trim()).toBe("");
  });
});
