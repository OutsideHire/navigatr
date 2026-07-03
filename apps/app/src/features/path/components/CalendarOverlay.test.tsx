import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CalendarOverlay } from "./CalendarOverlay";
import type { CalendarTimeBlock, CalendarWaypoint } from "../hooks/useCalendarEvents";
import type { Interval } from "../lib/freeWindows";

const waypoint: CalendarWaypoint = {
  id: "wp-1",
  title: "Acme HQ demo",
  start: "2026-07-03T14:00:00.000Z",
  end: "2026-07-03T15:00:00.000Z",
  address: "123 Main St, Springfield",
  lat: 40,
  lng: -80,
  source: "calendar",
};

const timeBlock: CalendarTimeBlock = {
  id: "tb-1",
  title: "1:1 with manager",
  start: "2026-07-03T16:00:00.000Z",
  end: "2026-07-03T16:30:00.000Z",
  reason: "no_location",
};

const freeWindow: Interval = {
  start: "2026-07-03T15:00:00.000Z",
  end: "2026-07-03T16:00:00.000Z",
};

describe("CalendarOverlay", () => {
  it("renders a card per waypoint with time, title, address, and From calendar", () => {
    render(
      <CalendarOverlay
        waypoints={[waypoint]}
        timeBlocks={[]}
        freeWindows={[]}
        status="ok"
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("Acme HQ demo")).toBeInTheDocument();
    expect(screen.getByText("123 Main St, Springfield")).toBeInTheDocument();
    expect(screen.getByText("From calendar")).toBeInTheDocument();
    // Local-tz clock time, format "h:mm AM/PM" — assert the shape, not the tz.
    const expectedTime = new Date(waypoint.start).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
  });

  it("marks waypoints read-only with an edit-the-meeting title", () => {
    render(
      <CalendarOverlay
        waypoints={[waypoint]}
        timeBlocks={[]}
        freeWindows={[]}
        status="ok"
        onRefresh={vi.fn()}
      />,
    );
    expect(
      screen.getByTitle("This stop is on your calendar. To change it, edit the meeting."),
    ).toBeInTheDocument();
  });

  it("renders a Meeting (no location) row per time-block", () => {
    render(
      <CalendarOverlay
        waypoints={[]}
        timeBlocks={[timeBlock]}
        freeWindows={[]}
        status="ok"
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("1:1 with manager")).toBeInTheDocument();
    expect(screen.getByText("Meeting (no location)")).toBeInTheDocument();
  });

  it("renders a free row per free window with duration", () => {
    render(
      <CalendarOverlay
        waypoints={[]}
        timeBlocks={[]}
        freeWindows={[freeWindow]}
        status="ok"
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/1h free/)).toBeInTheDocument();
  });

  it("orders the mixed set chronologically by start time", () => {
    // freeWindow (15:00) sits between waypoint (14:00) and timeBlock (16:00).
    render(
      <CalendarOverlay
        waypoints={[waypoint]}
        timeBlocks={[timeBlock]}
        freeWindows={[freeWindow]}
        status="ok"
        onRefresh={vi.fn()}
      />,
    );
    const text = document.body.textContent ?? "";
    const iWaypoint = text.indexOf("Acme HQ demo");
    const iFree = text.indexOf("free");
    const iBlock = text.indexOf("1:1 with manager");
    expect(iWaypoint).toBeGreaterThanOrEqual(0);
    expect(iWaypoint).toBeLessThan(iFree);
    expect(iFree).toBeLessThan(iBlock);
  });

  it("calls onRefresh when Refresh calendar is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <CalendarOverlay
        waypoints={[waypoint]}
        timeBlocks={[]}
        freeWindows={[]}
        status="ok"
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /refresh calendar/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("not_connected shows only the connect hint and nothing else", () => {
    render(
      <CalendarOverlay
        waypoints={[waypoint]}
        timeBlocks={[timeBlock]}
        freeWindows={[freeWindow]}
        status="not_connected"
        onRefresh={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /connect your calendar/i });
    expect(link).toHaveAttribute("href", "/settings/integrations");
    // Nothing else — no waypoints, no refresh button.
    expect(screen.queryByText("Acme HQ demo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refresh calendar/i })).not.toBeInTheDocument();
  });

  it("needs_reconnect shows the reconnect notice and still renders waypoints", () => {
    render(
      <CalendarOverlay
        waypoints={[waypoint]}
        timeBlocks={[]}
        freeWindows={[]}
        status="needs_reconnect"
        onRefresh={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /reconnect your calendar/i });
    expect(link).toHaveAttribute("href", "/settings/integrations");
    // Waypoints still render.
    expect(screen.getByText("Acme HQ demo")).toBeInTheDocument();
  });
});
