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
    stopCount,
  };
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
