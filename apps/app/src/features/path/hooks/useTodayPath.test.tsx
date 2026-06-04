import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTodayPath, todayISO } from "./useTodayPath";
import type { StopSnapshot } from "./usePathMutations";

const activeState = { current: { data: { path: null, stops: [] } as unknown, isLoading: false } };
const lastDate = { current: "" };
vi.mock("./useActivePath", () => ({
  useActivePath: (date: string) => { lastDate.current = date; return activeState.current; },
  ACTIVE_PATH_QUERY_KEY: ["paths", "active"],
}));

const createPath = vi.fn(async () => "p1");
const addStops = vi.fn(async () => {});
const removeStop = vi.fn(async () => {});
const setStopStatus = vi.fn(async () => {});
const setStopDisposition = vi.fn(async () => {});
const markDealCreatedM = vi.fn(async () => {});
const deletePath = vi.fn(async () => {});
vi.mock("./usePathMutations", () => ({
  usePathMutations: () => ({
    createPath: { mutateAsync: createPath },
    addStops: { mutateAsync: addStops },
    removeStop: { mutateAsync: removeStop },
    setStopStatus: { mutateAsync: setStopStatus },
    setStopDisposition: { mutateAsync: setStopDisposition },
    markDealCreated: { mutateAsync: markDealCreatedM },
    deletePath: { mutateAsync: deletePath },
  }),
}));

const SNAP: StopSnapshot = { prospectId: "m1", name: "A", address: null, lat: 1, lng: 2, category: "manufacturing", primaryType: null };

beforeEach(() => {
  [createPath, addStops, removeStop, setStopStatus, setStopDisposition, markDealCreatedM, deletePath].forEach((m) => m.mockClear());
  activeState.current = { data: { path: null, stops: [] }, isLoading: false };
});

describe("useTodayPath", () => {
  it("queries the active path for today's date", () => {
    renderHook(() => useTodayPath());
    expect(lastDate.current).toBe(todayISO());
  });

  it("exposes stops with snapshot fields (merchantId = prospectId)", () => {
    activeState.current = { data: { path: { id: "p1" }, stops: [
      { id: "s1", prospectId: "m1", name: "Uratex", address: "Rd", lat: 1, lng: 2,
        category: "manufacturing", primaryType: null, status: "visited",
        disposition: "met_dm", dealCreated: true, addedAt: "t1", position: 0 },
    ] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    expect(result.current.stops).toEqual([
      { merchantId: "m1", name: "Uratex", address: "Rd", lat: 1, lng: 2,
        category: "manufacturing", primaryType: null, status: "visited",
        disposition: "met_dm", dealCreated: true, addedAt: "t1" },
    ]);
    expect(result.current.has("m1")).toBe(true);
    expect(result.current.has("nope")).toBe(false);
    expect(result.current.isComplete()).toBe(true);
  });

  it("add: creates today's path then appends the snapshot at the end", async () => {
    activeState.current = { data: { path: { id: "p1" }, stops: [
      { id: "s1", prospectId: "x", status: "pending", disposition: null, dealCreated: false, addedAt: "t1", position: 0 },
    ] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    await act(async () => { await result.current.add(SNAP); });
    expect(createPath).toHaveBeenCalledWith({ date: todayISO(), originLabel: null, originLat: null, originLng: null });
    expect(addStops).toHaveBeenCalledWith({ pathId: "p1", basePosition: 1, stops: [SNAP] });
  });

  it("remove / setStatus / logVisit / markDealCreated resolve merchantId -> stop id", async () => {
    activeState.current = { data: { path: { id: "p1" }, stops: [
      { id: "s1", prospectId: "m1", status: "pending", disposition: null, dealCreated: false, addedAt: "t1", position: 0 },
    ] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    await act(async () => { await result.current.remove("m1"); });
    expect(removeStop).toHaveBeenCalledWith("s1");
    await act(async () => { await result.current.setStatus("m1", "skipped"); });
    expect(setStopStatus).toHaveBeenCalledWith({ stopId: "s1", status: "skipped" });
    await act(async () => { await result.current.logVisit("m1", "met_dm" as never); });
    expect(setStopDisposition).toHaveBeenCalledWith({ stopId: "s1", disposition: "met_dm" });
    expect(setStopStatus).toHaveBeenCalledWith({ stopId: "s1", status: "visited" });
    await act(async () => { await result.current.markDealCreated("m1"); });
    expect(markDealCreatedM).toHaveBeenCalledWith("s1");
  });

  it("clear deletes today's path when one exists", async () => {
    activeState.current = { data: { path: { id: "p1" }, stops: [] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    await act(async () => { await result.current.clear(); });
    expect(deletePath).toHaveBeenCalledWith("p1");
  });

  it("addMany: creates the path ONCE and appends all snapshots in a SINGLE addStops call", async () => {
    // Regression: handleStartPath used a per-stop loop (N createPath + N addStops),
    // gating the wizard close behind ~2N sequential round-trips so a full route left
    // the slide-out open for many seconds. addMany batches it to one create + one add.
    activeState.current = { data: { path: { id: "p1" }, stops: [] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    const snaps: StopSnapshot[] = [
      SNAP,
      { ...SNAP, prospectId: "m2", name: "B" },
      { ...SNAP, prospectId: "m3", name: "C" },
    ];
    await act(async () => { await result.current.addMany(snaps); });
    expect(createPath).toHaveBeenCalledTimes(1);
    expect(addStops).toHaveBeenCalledTimes(1);
    expect(addStops).toHaveBeenCalledWith({ pathId: "p1", basePosition: 0, stops: snaps });
  });

  it("addMany: no-ops on an empty selection", async () => {
    const { result } = renderHook(() => useTodayPath());
    await act(async () => { await result.current.addMany([]); });
    expect(createPath).not.toHaveBeenCalled();
    expect(addStops).not.toHaveBeenCalled();
  });
});
