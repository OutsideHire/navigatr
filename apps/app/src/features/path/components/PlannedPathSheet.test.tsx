import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { Path, PathStop } from "../lib/pathTypes";
import { todayISO, addDaysISO } from "../lib/today";
import { composeReminderAt } from "../lib/scheduleDate";

// Radix Dialog needs these in jsdom.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

// MerchantMap is MapLibre; expose what it was handed.
vi.mock("./MerchantMap", () => ({
  MerchantMap: (props: {
    merchants: Array<{ status?: string }>;
    routePath?: unknown[];
    showPosition?: boolean;
    fitToMerchants?: boolean;
  }) => (
    <div
      data-testid="map"
      data-pins={props.merchants.length}
      data-route={props.routePath?.length ?? 0}
      data-statuses={props.merchants.map((m) => m.status ?? "").join(",")}
      data-show-position={String(props.showPosition ?? true)}
      data-fit={String(props.fitToMerchants ?? false)}
    />
  ),
}));

let stopsData: PathStop[] = [];
let stopsFetching = false;
const activePathSpy = vi.fn();
vi.mock("../hooks/useActivePath", () => ({
  useActivePath: (date: string) => {
    activePathSpy(date);
    return { data: { path: null, stops: stopsData }, isLoading: false, isFetching: stopsFetching };
  },
}));

let pathsData: Path[] = [];
vi.mock("../hooks/usePaths", () => ({
  usePaths: () => ({ data: pathsData }),
}));

const { updatePath, removeStop, reorderStops, deletePlannedPath, syncPath } = vi.hoisted(() => ({
  updatePath: vi.fn(),
  removeStop: vi.fn(),
  reorderStops: vi.fn(),
  deletePlannedPath: vi.fn(),
  syncPath: vi.fn(),
}));
vi.mock("../hooks/usePathMutations", async (orig) => {
  const actual = await orig<typeof import("../hooks/usePathMutations")>();
  return {
    ...actual,
    usePathMutations: () => ({
      updatePath: { mutateAsync: updatePath, isPending: false },
      removeStop: { mutateAsync: removeStop, isPending: false },
      reorderStops: { mutateAsync: reorderStops, isPending: false },
      deletePlannedPath: { mutateAsync: deletePlannedPath, isPending: false },
    }),
  };
});
vi.mock("../hooks/usePathCalendarSync", () => ({ usePathCalendarSync: () => ({ syncPath }) }));

import { PlannedPathSheet } from "./PlannedPathSheet";

const FUTURE = addDaysISO(todayISO(), 5);

function makePath(overrides: Partial<Path> = {}): Path {
  return {
    id: "p1",
    date: FUTURE,
    name: "Edmond run",
    originLabel: "Edmond, OK 73034, USA",
    originLat: 35.65,
    originLng: -97.47,
    status: "planned",
    reminderAt: composeReminderAt(FUTURE, "08:30"),
    startedAt: null,
    stopCount: 3,
    pathCalendarSyncStatus: "synced",
    ...overrides,
  };
}

function stop(id: string, name: string, position: number, address: string | null = `${position} Main St`): PathStop {
  return {
    id, pathId: "p1", prospectId: `pr-${id}`, placeId: null, name, address, phone: null,
    lat: 35.6 + position / 100, lng: -97.4, category: "retail" as PathStop["category"], primaryType: null,
    position, status: "pending", disposition: null, notes: null, dealCreated: false, addedAt: "2026-10-01T00:00:00Z",
  };
}

const onOpenChange = vi.fn();
const onMovedToToday = vi.fn();

function renderSheet(path: Path = makePath()) {
  return render(
    <PlannedPathSheet path={path} open onOpenChange={onOpenChange} onMovedToToday={onMovedToToday} />,
  );
}

beforeEach(() => {
  stopsData = [stop("s1", "Alpha Cafe", 0), stop("s2", "Bravo Tire", 1), stop("s3", "Charlie Dental", 2)];
  pathsData = [];
  stopsFetching = false;
  for (const f of [updatePath, removeStop, reorderStops, deletePlannedPath, syncPath, onOpenChange, onMovedToToday, activePathSpy]) {
    f.mockReset();
  }
  updatePath.mockResolvedValue(undefined);
  removeStop.mockResolvedValue(undefined);
  reorderStops.mockResolvedValue(undefined);
  deletePlannedPath.mockResolvedValue(undefined);
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

describe("PlannedPathSheet: view", () => {
  it("shows the path's name, date, reminder, its stops in order and a map of them", () => {
    renderSheet();
    expect(activePathSpy).toHaveBeenCalledWith(FUTURE);
    expect(screen.getByRole("heading", { name: "Edmond run" })).toBeInTheDocument();
    expect(screen.getByText(/3 stops/)).toBeInTheDocument();
    expect(screen.getByText(/8:30 AM/)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: /stops/i });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByText(/Alpha|Bravo|Charlie/).textContent)).toEqual([
      "Alpha Cafe",
      "Bravo Tire",
      "Charlie Dental",
    ]);
    expect(within(rows[0]!).getByText("0 Main St")).toBeInTheDocument();
    const map = screen.getByTestId("map");
    expect(map).toHaveAttribute("data-pins", "3");
    expect(map).toHaveAttribute("data-route", "3");
    // Pins need a real status (MerchantMap colors by it), no "you are here"
    // marker for another day's plan, and the view fits the stops.
    expect(map).toHaveAttribute("data-statuses", "prospect,prospect,prospect");
    expect(map).toHaveAttribute("data-show-position", "false");
    expect(map).toHaveAttribute("data-fit", "true");
  });

  it("titles the details section for editing", () => {
    renderSheet();
    expect(screen.getByRole("heading", { level: 3, name: "When" })).toBeInTheDocument();
    expect(screen.getByText("Move it to another day or change the reminder.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /schedule your path/i })).not.toBeInTheDocument();
  });
});

describe("PlannedPathSheet: edit stops", () => {
  it("removes a stop", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Remove Bravo Tire" }));
    await waitFor(() => expect(removeStop).toHaveBeenCalledWith("s2"));
  });

  it("moves a stop down and saves the new order", async () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Move Alpha Cafe up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Alpha Cafe down" }));
    await waitFor(() =>
      expect(reorderStops).toHaveBeenCalledWith({ orderedStopIds: ["s2", "s1", "s3"] }),
    );
  });

  it("moves a stop up", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Move Charlie Dental up" }));
    await waitFor(() =>
      expect(reorderStops).toHaveBeenCalledWith({ orderedStopIds: ["s1", "s3", "s2"] }),
    );
  });

  it("removing the last stop offers to delete the path instead", async () => {
    stopsData = [stop("s1", "Alpha Cafe", 0)];
    renderSheet(makePath({ stopCount: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Alpha Cafe" }));
    expect(removeStop).not.toHaveBeenCalled();
    expect(screen.getByText(/last stop/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(deletePlannedPath).toHaveBeenCalledWith("p1"));
  });
});

describe("PlannedPathSheet: edit details", () => {
  it("renames the path and re-syncs its calendar block", async () => {
    renderSheet();
    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/name this path/i), { target: { value: "Edmond north" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(updatePath).toHaveBeenCalledWith({
        pathId: "p1",
        name: "Edmond north",
        date: FUTURE,
        reminderAt: composeReminderAt(FUTURE, "08:30"),
      }),
    );
    await waitFor(() => expect(syncPath).toHaveBeenCalledWith("p1"));
    expect(onMovedToToday).not.toHaveBeenCalled();
  });

  it("changing the reminder time saves it and re-syncs the calendar block", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText(/remind me at/i), { target: { value: "09:15" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(updatePath).toHaveBeenCalledWith(
        expect.objectContaining({ pathId: "p1", reminderAt: composeReminderAt(FUTURE, "09:15") }),
      ),
    );
    await waitFor(() => expect(syncPath).toHaveBeenCalledWith("p1"));
  });

  it("moves the reminder with the date and loads the stops for the new day", async () => {
    const newDate = addDaysISO(todayISO(), 9);
    renderSheet();
    fireEvent.change(screen.getByLabelText(/or pick a date/i), { target: { value: newDate } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(updatePath).toHaveBeenCalledWith({
        pathId: "p1",
        name: "Edmond run",
        date: newDate,
        reminderAt: composeReminderAt(newDate, "08:30"),
      }),
    );
    await waitFor(() => expect(syncPath).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(activePathSpy).toHaveBeenLastCalledWith(newDate));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("blocks a day that already has a path, with a clear message, and changes nothing", () => {
    const taken = addDaysISO(todayISO(), 7);
    pathsData = [makePath(), makePath({ id: "other", date: taken, name: "Other" })];
    renderSheet();
    fireEvent.change(screen.getByLabelText(/or pick a date/i), { target: { value: taken } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(screen.getByText("You already have a path on that day.")).toBeInTheDocument();
    expect(updatePath).not.toHaveBeenCalled();
    expect(syncPath).not.toHaveBeenCalled();
  });

  it("shows the same message when the database rejects the day (unique violation)", async () => {
    updatePath.mockRejectedValueOnce({ code: "23505", message: "duplicate key" });
    renderSheet();
    fireEvent.change(screen.getByLabelText(/or pick a date/i), { target: { value: addDaysISO(todayISO(), 8) } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("You already have a path on that day.")).toBeInTheDocument();
    expect(syncPath).not.toHaveBeenCalled();
  });

  it("refuses a past date", () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText(/or pick a date/i), { target: { value: addDaysISO(todayISO(), -2) } });
    expect(screen.getByText(/choose today or a future date/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("moving the path to today closes the sheet and lands on today's route", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^today/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(updatePath).toHaveBeenCalledWith(expect.objectContaining({ pathId: "p1", date: todayISO() })),
    );
    await waitFor(() => expect(onMovedToToday).toHaveBeenCalledTimes(1));
  });
});

describe("PlannedPathSheet: delete", () => {
  it("asks to confirm, and Keep it backs out", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^delete path$/i }));
    expect(screen.getByText(/delete this path\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /keep it/i }));
    expect(deletePlannedPath).not.toHaveBeenCalled();
    expect(screen.queryByText(/delete this path\?/i)).not.toBeInTheDocument();
  });

  it("deletes after confirming and closes the sheet", async () => {
    renderSheet(makePath({ pathCalendarSyncStatus: null }));
    fireEvent.click(screen.getByRole("button", { name: /^delete path$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(deletePlannedPath).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("PlannedPathSheet: busy and race guards", () => {
  it("disables Move while the stops are refetching (reorder race)", () => {
    stopsFetching = true;
    renderSheet();
    expect(screen.getByRole("button", { name: "Move Alpha Cafe down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Charlie Dental up" })).toBeDisabled();
  });

  it("disables Save changes and the stop buttons while a stop edit is saving", async () => {
    let finish: () => void = () => {};
    removeStop.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    renderSheet();
    fireEvent.change(screen.getByLabelText(/name this path/i), { target: { value: "Edmond north" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Bravo Tire" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Remove Alpha Cafe" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Alpha Cafe down" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled());
  });

  it("disables the stop buttons while the details are saving", async () => {
    let finish: () => void = () => {};
    updatePath.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    renderSheet();
    fireEvent.change(screen.getByLabelText(/name this path/i), { target: { value: "Edmond north" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Alpha Cafe" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Move Alpha Cafe down" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Alpha Cafe" })).toBeEnabled());
  });
});

describe("PlannedPathSheet: moving to a today that already has a route", () => {
  it("points the rep to Path when today's row has no stops", () => {
    pathsData = [makePath(), makePath({ id: "today-row", date: todayISO(), name: null, stopCount: 0 })];
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^today/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(screen.getByText("Today already has a route. Add stops from Path.")).toBeInTheDocument();
    expect(updatePath).not.toHaveBeenCalled();
  });

  it("uses the plain message when today's path already has stops", () => {
    pathsData = [makePath(), makePath({ id: "today-row", date: todayISO(), stopCount: 4 })];
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^today/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(screen.getByText("You already have a path on that day.")).toBeInTheDocument();
  });
});

describe("PlannedPathSheet: error paths", () => {
  it("a failed save shows a retry message and does not re-sync", async () => {
    updatePath.mockRejectedValueOnce(new Error("network"));
    renderSheet();
    fireEvent.change(screen.getByLabelText(/name this path/i), { target: { value: "Edmond north" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(syncPath).not.toHaveBeenCalled();
    expect(onMovedToToday).not.toHaveBeenCalled();
  });

  it("a failed remove shows an error toast", async () => {
    removeStop.mockRejectedValueOnce(new Error("x"));
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Remove Bravo Tire" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't remove the stop. Try again."));
  });

  it("a failed reorder shows an error toast", async () => {
    reorderStops.mockRejectedValueOnce(new Error("x"));
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Move Alpha Cafe down" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't reorder. Try again."));
  });

  it("a failed delete shows an error toast and keeps the sheet open", async () => {
    deletePlannedPath.mockRejectedValueOnce(new Error("x"));
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^delete path$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't delete the path. Try again."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeEnabled();
  });
});
