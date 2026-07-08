import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoutePreview } from "./RoutePreview";
import type { MerchantWithDistance } from "./MerchantList";
import type { RouteStats } from "../lib/routeStats";
import type { ScheduleResult } from "../lib/scheduleDay";

function row(id: string, distanceMeters: number, over: Partial<MerchantWithDistance> = {}): MerchantWithDistance {
  return {
    id, name: id, category: "automotive", address: `${id} St`, lat: 35, lng: -97,
    phone: "+15125550100", employeeCountRange: "", status: "untouched", lastActivity: null,
    isChain: false, distanceMeters, rating: 4.2, ...over,
  } as MerchantWithDistance;
}

const STATS: RouteStats = {
  stopCount: 6,
  nearestMeters: 643.7,   // ~0.4 mi
  furthestMeters: 13196,  // ~8.2 mi
  totalRouteMeters: 20000,
  etaMinutes: 210,        // ~3h 30m
};

function setup(count: number, statsOver: Partial<RouteStats> = {}) {
  const ordered = Array.from({ length: count }, (_, i) => row(`Stop${i + 1}`, (i + 1) * 643.7));
  const onBack = vi.fn();
  const onStart = vi.fn();
  render(<RoutePreview ordered={ordered} stats={{ ...STATS, stopCount: count, ...statsOver }} onBack={onBack} onStart={onStart} />);
  return { onBack, onStart };
}

describe("RoutePreview", () => {
  it("renders the four KPI values from stats", () => {
    setup(6);
    expect(screen.getByText("6")).toBeInTheDocument();          // Stops
    expect(screen.getByText("Stops")).toBeInTheDocument();
    expect(screen.getByText("0.4 mi")).toBeInTheDocument();     // Nearest
    expect(screen.getByText("8.2 mi")).toBeInTheDocument();     // Furthest
    expect(screen.getByText("~3h 30m")).toBeInTheDocument();    // Est. time
  });

  it("renders only the first 4 stops and a '+N more' line when longer", () => {
    setup(6);
    expect(screen.getByText("Stop1")).toBeInTheDocument();
    expect(screen.getByText("Stop4")).toBeInTheDocument();
    expect(screen.queryByText("Stop5")).not.toBeInTheDocument();
    expect(screen.getByText(/\+\s*2\s*more stops/i)).toBeInTheDocument();
  });

  it("renders all stops and no '+more' line at the 4-stop boundary", () => {
    setup(4);
    expect(screen.getByText("Stop4")).toBeInTheDocument();
    expect(screen.queryByText(/more stops/i)).not.toBeInTheDocument();
  });

  it("shows no employee or dollar-estimate text", () => {
    setup(4);
    expect(screen.queryByText(/emp\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("Back calls onBack and Start path calls onStart", () => {
    const { onBack, onStart } = setup(4);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /start path/i }));
    expect(onStart).toHaveBeenCalled();
  });

  describe("with a time-aware timeline", () => {
    const timeline: ScheduleResult = {
      timeline: [
        {
          kind: "prospect",
          id: "p-1",
          name: "Joe's Diner",
          arrive: "2026-07-08T14:00:00.000Z",
          depart: "2026-07-08T14:20:00.000Z",
        },
        {
          kind: "waypoint",
          id: "wp-1",
          title: "Acme HQ demo",
          start: "2026-07-08T15:00:00.000Z",
          end: "2026-07-08T16:00:00.000Z",
        },
      ],
      conflicts: [],
      unscheduledProspectIds: [],
    };

    function setupTimeline() {
      const ordered = Array.from({ length: 3 }, (_, i) => row(`Stop${i + 1}`, (i + 1) * 643.7));
      const onBack = vi.fn();
      const onStart = vi.fn();
      render(
        <RoutePreview
          ordered={ordered}
          stats={{ ...STATS, stopCount: 3 }}
          onBack={onBack}
          onStart={onStart}
          timeline={timeline}
        />,
      );
      return { onBack, onStart };
    }

    it("renders the PathTimeline rows instead of the ordered-stop list", () => {
      setupTimeline();
      // Timeline rows show: the scheduled prospect + the fixed meeting.
      expect(screen.getByText("Joe's Diner")).toBeInTheDocument();
      expect(screen.getByText("Acme HQ demo")).toBeInTheDocument();
      expect(screen.getByText("Meeting")).toBeInTheDocument();
      // The plain ordered-stop list is NOT rendered.
      expect(screen.queryByText("Stop1")).not.toBeInTheDocument();
    });

    it("still renders the KPI stats header and the Start/Back footer", () => {
      const { onBack, onStart } = setupTimeline();
      // KPI summary header persists (label + its value, side by side).
      const stopsLabel = screen.getByText("Stops");
      expect(stopsLabel).toBeInTheDocument();
      expect(stopsLabel.parentElement).toHaveTextContent("3");
      // Footer buttons persist and still fire.
      fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
      expect(onBack).toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: /start path/i }));
      expect(onStart).toHaveBeenCalled();
    });
  });
});
