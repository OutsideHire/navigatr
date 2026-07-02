/**
 * Path v3 domain types + row mappers. Mirrors the paths/path_stops tables
 * (migration 20260603000001). Centralizing the snake_case → camelCase mapping
 * keeps the hooks and UI off raw row shapes.
 */
import type { MerchantCategory } from "../mockData";

export type PathStatus = "planned" | "completed";
export type StopStatus = "pending" | "visited" | "skipped";

export interface Path {
  id: string;
  date: string;            // ISO date (yyyy-mm-dd)
  name: string | null;     // optional human name (SP3 scheduling)
  originLabel: string | null;
  originLat: number | null;
  originLng: number | null;
  status: PathStatus;
  reminderAt: string | null; // ISO timestamptz for the in-app reminder (SP3)
  // ISO timestamptz stamped when the rep actually starts running the path
  // (Create a Path). Null = Planned (not yet started). Drives the lifecycle
  // landing rule (see pathLanding). Nullable so legacy paths stay Planned.
  startedAt: string | null;
  stopCount: number;
}

export interface PathStop {
  id: string;
  pathId: string;
  prospectId: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  category: MerchantCategory;
  primaryType: string | null;
  position: number;
  status: StopStatus;
  disposition: string | null;
  dealCreated: boolean;
  addedAt: string;
}

export interface PathRow {
  id: string;
  path_date: string;
  name?: string | null;
  origin_label: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  status: PathStatus;
  reminder_at?: string | null;
  started_at?: string | null;
}

export interface PathStopRow {
  id: string;
  path_id: string;
  prospect_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  category: string;
  primary_type: string | null;
  position: number;
  status: StopStatus;
  disposition: string | null;
  deal_created: boolean;
  added_at: string;
}

export function rowToPath(row: PathRow, stopCount: number): Path {
  return {
    id: row.id,
    date: row.path_date,
    name: row.name ?? null,
    originLabel: row.origin_label,
    originLat: row.origin_lat,
    originLng: row.origin_lng,
    status: row.status,
    reminderAt: row.reminder_at ?? null,
    startedAt: row.started_at ?? null,
    stopCount,
  };
}

// ─── Lifecycle helpers ────────────────────────────────────────────────
//
// The "current stop" is derived, never stored: it's the first stop by position
// whose status is still 'pending'. Marking stops visited/skipped advances it
// naturally, so there's no pointer column to drift out of sync.

/** A stop shape carrying just position + status — all the lifecycle math needs. */
export interface StopLike {
  position: number;
  status: StopStatus;
}

/**
 * Index (into the by-position order) of the first pending stop, or -1 if none.
 * The returned index is into the position-sorted stop list — RunningPath renders
 * stops in that same order, so it can seek straight to this index.
 */
export function firstPendingIndex(stops: StopLike[]): number {
  const ordered = [...stops].sort((a, b) => a.position - b.position);
  return ordered.findIndex((s) => s.status === "pending");
}

export type PathLanding = "run" | "summary" | "entry";

/**
 * The lifecycle landing rule (see the design's lifecycle table):
 *   started_at null                -> 'entry'   (Planned; Entry / Upcoming)
 *   started_at set + pending stops  -> 'run'     (In progress; Run @ first pending)
 *   started_at set + no pending     -> 'summary' (Completed)
 * Pure so it's unit-testable without mounting the page.
 */
export function pathLanding({
  startedAt,
  hasPendingStops,
}: {
  startedAt: string | null | undefined;
  hasPendingStops: boolean;
}): PathLanding {
  if (!startedAt) return "entry";
  return hasPendingStops ? "run" : "summary";
}

export function rowToStop(row: PathStopRow): PathStop {
  return {
    id: row.id,
    pathId: row.path_id,
    prospectId: row.prospect_id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    lat: row.lat,
    lng: row.lng,
    category: row.category as MerchantCategory,
    primaryType: row.primary_type,
    position: row.position,
    status: row.status,
    disposition: row.disposition,
    dealCreated: row.deal_created,
    addedAt: row.added_at,
  };
}
