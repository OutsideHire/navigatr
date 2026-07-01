import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Path } from "../lib/pathTypes";

let pathsData: Path[] = [];
vi.mock("../hooks/usePaths", () => ({
  usePaths: () => ({ data: pathsData }),
  PATHS_QUERY_KEY: ["paths", "list"],
}));

import { UpcomingPaths } from "./UpcomingPaths";

function makePath(overrides: Partial<Path> = {}): Path {
  return {
    id: "p1",
    date: "2026-07-05",
    name: "Downtown run",
    originLabel: "Austin, TX",
    originLat: 30,
    originLng: -97,
    status: "planned",
    reminderAt: null,
    stopCount: 3,
    ...overrides,
  };
}

const TODAY = "2026-07-01";

beforeEach(() => {
  pathsData = [];
});

describe("UpcomingPaths", () => {
  it("renders nothing when there are no future planned paths", () => {
    pathsData = [];
    const { container } = render(<UpcomingPaths onLaunch={vi.fn()} todayIso={TODAY} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists future planned paths with name + stop count", () => {
    pathsData = [makePath({ id: "a", name: "Route A", date: "2026-07-05", stopCount: 4 })];
    render(<UpcomingPaths onLaunch={vi.fn()} todayIso={TODAY} />);
    expect(screen.getByText("Route A")).toBeInTheDocument();
    expect(screen.getByText(/4 stops/i)).toBeInTheDocument();
  });

  it("excludes past-dated and completed paths", () => {
    pathsData = [
      makePath({ id: "past", name: "Past", date: "2026-06-30" }),
      makePath({ id: "done", name: "Done", date: "2026-07-05", status: "completed" }),
      makePath({ id: "ok", name: "Keep", date: "2026-07-05" }),
    ];
    render(<UpcomingPaths onLaunch={vi.fn()} todayIso={TODAY} />);
    expect(screen.queryByText("Past")).not.toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.getByText("Keep")).toBeInTheDocument();
  });

  it("excludes today's path (that's the active/entry path, not 'upcoming')", () => {
    pathsData = [makePath({ id: "t", name: "Today run", date: TODAY })];
    const { container } = render(<UpcomingPaths onLaunch={vi.fn()} todayIso={TODAY} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("launches a path via the callback", () => {
    const onLaunch = vi.fn();
    pathsData = [makePath({ id: "a", name: "Route A", date: "2026-07-05" })];
    render(<UpcomingPaths onLaunch={onLaunch} todayIso={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect((onLaunch.mock.calls[0]![0] as Path).id).toBe("a");
  });
});
