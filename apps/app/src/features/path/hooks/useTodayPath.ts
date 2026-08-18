/**
 * useTodayPath — server-backed "today's path" with a usePathQueue-shaped surface.
 *
 * Drop-in for the old local queue: stops are keyed by `merchantId` (= the
 * prospect id), and the ops mirror the queue's. Reads come from
 * useActivePath(today); writes go through usePathMutations and refresh via query
 * invalidation. `add` takes a full snapshot (the caller has the merchant) and
 * lazily creates today's path. Writes return promises for sequencing/tests but
 * callers needn't await (UI refreshes on invalidation).
 */
import * as React from "react";
import type { Disposition } from "@/lib/followUpScheduling";
import { useActivePath } from "./useActivePath";
import { usePathMutations, type StopSnapshot } from "./usePathMutations";
import type { StopStatus } from "../lib/pathTypes";
import { todayISO } from "../lib/today";
export { todayISO };

/** Queue-compatible stop shape the existing components read. */
export interface TodayStop {
  merchantId: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  category: string;
  primaryType: string | null;
  status: StopStatus;
  disposition: string | null;
  notes: string | null;
  dealCreated: boolean;
  addedAt: string;
}

export function useTodayPath() {
  const date = todayISO();
  const { data, isLoading } = useActivePath(date);
  const m = usePathMutations();

  const path = data?.path ?? null;
  const rawStops = data?.stops ?? [];

  const stops: TodayStop[] = React.useMemo(
    () => rawStops.map((s) => ({
      merchantId: s.prospectId, name: s.name, address: s.address, phone: s.phone, lat: s.lat, lng: s.lng,
      category: s.category, primaryType: s.primaryType, status: s.status,
      disposition: s.disposition, notes: s.notes, dealCreated: s.dealCreated, addedAt: s.addedAt,
    })),
    [rawStops],
  );

  const stopIdFor = (merchantId: string): string | undefined =>
    rawStops.find((s) => s.prospectId === merchantId)?.id;

  // Always upsert (idempotent on user_id,path_date) rather than short-circuiting
  // on the cached `path?.id`. This is deliberate: handleStartPath does clear()
  // (deletePath) THEN add() in a loop, and the cached `path` stays stale (the
  // just-deleted row) until invalidation refetches — short-circuiting there would
  // addStops onto a deleted path_id and FK-fail. The extra upsert per add is the
  // accepted cost of that safety. Do NOT "optimize" this to `path?.id ?? ...`.
  const ensurePathId = async (opts?: { startedAt?: string }): Promise<string> =>
    await m.createPath.mutateAsync({
      date, originLabel: null, originLat: null, originLng: null,
      // Only pass startedAt when the caller wants to auto-start (Create flow); the
      // createPath upsert leaves the column untouched otherwise (Planned paths).
      ...(opts?.startedAt !== undefined ? { startedAt: opts.startedAt } : {}),
    });

  const add = async (snapshot: StopSnapshot): Promise<void> => {
    const pathId = await ensurePathId();
    // basePosition from the rendered stop count. Under concurrent adds two stops
    // can land on the same position (both still persist; order is then advisory).
    // Acceptable for a field tool; revisit with server-side position assignment.
    await m.addStops.mutateAsync({ pathId, basePosition: rawStops.length, stops: [snapshot] });
  };
  // Batched add for building a whole route at once (handleStartPath). One path
  // upsert + one addStops insert for ALL stops — NOT a per-stop loop, which would
  // be ~2N sequential round-trips and gate the caller's UI (e.g. the wizard close)
  // behind every write. addStops assigns position = basePosition + index.
  // `opts.start` (Create a Path auto-start) stamps started_at = now() on the path
  // upsert so the page lands the rep straight in the Run tab at stop 1. Plan a Path
  // omits it, leaving the path Planned. Snapshots-only adds (Add stops) omit it too.
  const addMany = async (snapshots: StopSnapshot[], opts?: { start?: boolean }): Promise<void> => {
    if (snapshots.length === 0) return;
    const pathId = await ensurePathId(opts?.start ? { startedAt: new Date().toISOString() } : undefined);
    await m.addStops.mutateAsync({ pathId, basePosition: rawStops.length, stops: snapshots });
  };
  // Stamp started_at without adding stops — "start" a day from the landing.
  // If a path row exists, mark it started. If none exists yet (an appointment /
  // follow-up-only day has nothing to persist as a merchant stop), CREATE the
  // path already stamped started, so the day is genuinely "started" (started_at
  // set) and the run surface renders it instead of bouncing back to the entry
  // landing. The run reads appointments / owed / due-today live, so an empty
  // path_stops set is fine.
  const start = async (): Promise<void> => {
    if (path?.id) {
      await m.markStarted.mutateAsync(path.id);
      return;
    }
    await ensurePathId({ startedAt: new Date().toISOString() });
  };
  const remove = async (merchantId: string): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (id) await m.removeStop.mutateAsync(id);
  };
  const setStatus = async (merchantId: string, status: StopStatus): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (id) await m.setStopStatus.mutateAsync({ stopId: id, status });
  };
  const logVisit = async (merchantId: string, disposition: Disposition, notes?: string): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (!id) return;
    await m.setStopDisposition.mutateAsync({ stopId: id, disposition, notes });
    await m.setStopStatus.mutateAsync({ stopId: id, status: "visited" });
  };
  const markDealCreated = async (merchantId: string): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (id) await m.markDealCreated.mutateAsync(id);
  };
  const clear = async (): Promise<void> => {
    if (path?.id) await m.deletePath.mutateAsync(path.id);
  };

  const has = (merchantId: string): boolean => rawStops.some((s) => s.prospectId === merchantId);
  const isComplete = (): boolean => rawStops.length > 0 && rawStops.every((s) => s.status !== "pending");
  const pendingCount = (): number => rawStops.filter((s) => s.status === "pending").length;

  return { pathId: path?.id ?? null, startedAt: path?.startedAt ?? null, isLoading, stops, add, addMany, start, remove, setStatus, logVisit, markDealCreated, clear, has, isComplete, pendingCount };
}
