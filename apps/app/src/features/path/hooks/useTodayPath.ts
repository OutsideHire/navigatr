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

/** Today's local date as yyyy-mm-dd (path_date is a calendar day, local to the rep). */
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Queue-compatible stop shape the existing components read. */
export interface TodayStop {
  merchantId: string;
  status: StopStatus;
  disposition: string | null;
  dealCreated: boolean;
  addedAt: string;
}

export function useTodayPath() {
  const date = todayISO();
  const { data } = useActivePath(date);
  const m = usePathMutations();

  const path = data?.path ?? null;
  const rawStops = data?.stops ?? [];

  const stops: TodayStop[] = React.useMemo(
    () => rawStops.map((s) => ({
      merchantId: s.prospectId, status: s.status, disposition: s.disposition,
      dealCreated: s.dealCreated, addedAt: s.addedAt,
    })),
    [rawStops],
  );

  const stopIdFor = (merchantId: string): string | undefined =>
    rawStops.find((s) => s.prospectId === merchantId)?.id;

  const ensurePathId = async (): Promise<string> =>
    await m.createPath.mutateAsync({ date, originLabel: null, originLat: null, originLng: null });

  const add = async (snapshot: StopSnapshot): Promise<void> => {
    const pathId = await ensurePathId();
    await m.addStops.mutateAsync({ pathId, basePosition: rawStops.length, stops: [snapshot] });
  };
  const remove = async (merchantId: string): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (id) await m.removeStop.mutateAsync(id);
  };
  const setStatus = async (merchantId: string, status: StopStatus): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (id) await m.setStopStatus.mutateAsync({ stopId: id, status });
  };
  const logVisit = async (merchantId: string, disposition: Disposition): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (!id) return;
    await m.setStopDisposition.mutateAsync({ stopId: id, disposition });
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

  return { pathId: path?.id ?? null, stops, add, remove, setStatus, logVisit, markDealCreated, clear, has, isComplete, pendingCount };
}
