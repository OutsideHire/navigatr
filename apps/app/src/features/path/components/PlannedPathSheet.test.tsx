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
let stopsLoaded = true;
const activePathSpy = vi.fn();
vi.mock("../hooks/useActivePath", () => ({
  useActivePath: (date: string) => {
    activePathSpy(date);
    return stopsLoaded
      ? { data: { path: null, stops: stopsData }, isLoading: false, isFetching: stopsFetching }
      : { data: undefined, isLoading: true, isFetching: true };
  },
}));

let pathsData: Path[] = [];
vi.mock("../hooks/usePaths", () => ({
  usePaths: () => ({ data: pathsData }),
}));

// Discovery for "Add stops": record the origin it was asked for and hand back
// whatever the test set.
const merchantsSpy = vi.fn();
let merchantsData: Array<Record<string, unknown>> = [];
let merchantsLoading = false;
let merchantsError = false;
vi.mock("../hooks/useMerchants", () => ({
  useMerchants: (origin: unknown, opts: unknown) => {
    merchantsSpy(origin, opts);
    return {
      merchants: origin ? merchantsData : [],
      hidden: { chains: 0, inPipeline: 0, homeBased: 0 },
      isLoading: origin ? merchantsLoading : false,
      isError: merchantsError,
      refetch: vi.fn(),
      effectiveRadiusM: 8047,
      requestedRadiusM: 8047,
      requestedLimit: 25,
    };
  },
}));

const { updatePath, removeStop, reorderStops, deletePlannedPath, syncPath, addStops } = vi.hoisted(() => ({
  addStops: vi.fn(),
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
      addStops: { mutateAsync: addStops, isPending: false },
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
  stopsLoaded = true;
  merchantsData = [];
  merchantsLoading = false;
  merchantsError = false;
  for (const f of [updatePath, removeStop, reorderStops, deletePlannedPath, syncPath, addStops, merchantsSpy, onOpenChange, onMovedToToday, activePathSpy]) {
    f.mockReset();
  }
  updatePath.mockResolvedValue(undefined);
  removeStop.mockResolvedValue(undefined);
  reorderStops.mockResolvedValue(undefined);
  deletePlannedPath.mockResolvedValue(undefined);
  addStops.mockResolvedValue(undefined);
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
    expect(screen.getByText("Today already has a path. Add stops from there.")).toBeInTheDocument();
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

function nearby(id: string, name: string, lat: number): Record<string, unknown> {
  return {
    id, placeId: `place-${id}`, name, category: "retail", address: `${name} address`, lat, lng: -97.47,
    phone: "4055550100", employeeCountRange: "", status: "untouched", lastActivity: null, primaryType: "store",
  };
}

describe("PlannedPathSheet: add stops", () => {
  it("does not search for businesses until the rep asks to add stops", () => {
    renderSheet();
    expect(merchantsSpy).not.toHaveBeenCalled();
  });

  it("lists nearby businesses around the path's area, minus the ones already on it", () => {
    merchantsData = [nearby("pr-s1", "Alpha Cafe", 35.651), nearby("m1", "Delta Deli", 35.652), nearby("m2", "Echo Auto", 35.66)];
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^add stops$/i }));
    const lastCall = merchantsSpy.mock.calls.at(-1)!;
    expect(lastCall[0]).toEqual({ lat: 35.65, lng: -97.47 });
    expect(lastCall[1]).toMatchObject({ includeChains: false, fillToLimit: true });
    expect(screen.getByText("Delta Deli")).toBeInTheDocument();
    expect(screen.getByText("Echo Auto")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Cafe")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /log drop-in/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();
  });

  it("appends the picked businesses after the current stops, re-syncs the calendar and returns to the stop list", async () => {
    merchantsData = [nearby("m2", "Echo Auto", 35.66), nearby("m1", "Delta Deli", 35.652)];
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^add stops$/i }));
    for (const b of screen.getAllByRole("button", { name: "Add to path" })) fireEvent.click(b);
    fireEvent.click(screen.getByRole("button", { name: /^add 2 stops$/i }));
    await waitFor(() => expect(addStops).toHaveBeenCalledTimes(1));
    const arg = addStops.mock.calls[0]![0];
    expect(arg.pathId).toBe("p1");
    expect(arg.basePosition).toBe(3);
    // Nearest to the area first.
    expect(arg.stops.map((s: { prospectId: string }) => s.prospectId)).toEqual(["m1", "m2"]);
    expect(arg.stops[0]).toEqual({
      prospectId: "m1", placeId: "place-m1", name: "Delta Deli", address: "Delta Deli address",
      phone: "4055550100", lat: 35.652, lng: -97.47, category: "retail", primaryType: "store",
    });
    expect(syncPath).toHaveBeenCalledWith("p1");
    expect(toastMock.success).toHaveBeenCalledWith("Added 2 stops");
    await waitFor(() => expect(screen.getByRole("list", { name: /stops/i })).toBeInTheDocument());
  });

  it("starts after the highest stop position when a removal left a gap", async () => {
    stopsData = [stop("s1", "Alpha Cafe", 0), stop("s3", "Charlie Dental", 2)];
    merchantsData = [nearby("m1", "Delta Deli", 35.652)];
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^add stops$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add to path" }));
    fireEvent.click(screen.getByRole("button", { name: /^add 1 stop$/i }));
    await waitFor(() => expect(addStops).toHaveBeenCalledTimes(1));
    expect(addStops.mock.calls[0]![0].basePosition).toBe(3);
  });

  it("offers Add stops only once the current stops have loaded", () => {
    stopsLoaded = false;
    renderSheet();
    expect(screen.queryByRole("button", { name: /^add stops$/i })).not.toBeInTheDocument();
  });

  it("counts and adds only picks still in the list after the list changes", async () => {
    merchantsData = [nearby("m1", "Delta Deli", 35.652), nearby("m2", "Echo Auto", 35.66)];
    const { rerender } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^add stops$/i }));
    for (const b of screen.getAllByRole("button", { name: "Add to path" })) fireEvent.click(b);
    expect(screen.getByRole("button", { name: /^add 2 stops$/i })).toBeInTheDocument();
    merchantsData = [nearby("m1", "Delta Deli", 35.652)];
    rerender(<PlannedPathSheet path={makePath()} open onOpenChange={onOpenChange} onMovedToToday={onMovedToToday} />);
    fireEvent.click(screen.getByRole("button", { name: /^add 1 stop$/i }));
    await waitFor(() => expect(addStops).toHaveBeenCalledTimes(1));
    expect(addStops.mock.calls[0]![0].stops.map((s: { prospectId: string }) => s.prospectId)).toEqual(["m1"]);
  });

  it("Back returns to the stop list without saving anything", () => {
    merchantsData = [nearby("m1", "Delta Deli", 35.652)];
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^add stops$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add to path" }));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(addStops).not.toHaveBeenCalled();
    expect(screen.getByRole("list", { name: /stops/i })).toBeInTheDocument();
  });

  it("a failed add shows an error toast and keeps the picks", async () => {
    addStops.mockRejectedValueOnce(new Error("x"));
    merchantsData = [nearby("m1", "Delta Deli", 35.652)];
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^add stops$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add to path" }));
    fireEvent.click(screen.getByRole("button", { name: /^add 1 stop$/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Couldn't add the stops. Try again."));
    expect(syncPath).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^add 1 stop$/i })).toBeEnabled();
  });

  it("uses the first stop as the area when the path has no saved center", () => {
    renderSheet(makePath({ originLat: null, originLng: null }));
    fireEvent.click(screen.getByRole("button", { name: /^add stops$/i }));
    expect(merchantsSpy.mock.calls.at(-1)![0]).toEqual({ lat: 35.6, lng: -97.4 });
  });
});
