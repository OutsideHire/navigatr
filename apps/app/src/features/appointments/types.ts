// App-side type + row mapper for the scheduled_appointments table. The DB row
// is snake_case; the app works in camelCase. rowToAppointment is a straight
// field map (no logic) so it stays trivially correct as columns are added.

export type AppointmentStatus = "scheduled" | "cancelled" | "completed";
export type CalendarSyncStatus = "pending" | "synced" | "error";

export interface ScheduledAppointment {
  id: string;
  dealId: string;
  ownerId: string;
  title: string;
  startAt: string;
  endAt: string;
  locationAddress: string | null;
  locationLat: number | null;
  locationLng: number | null;
  notes: string | null;
  status: AppointmentStatus;
  calendarEventId: string | null;
  calendarSyncStatus: CalendarSyncStatus;
  calendarSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledAppointmentRow {
  id: string;
  deal_id: string;
  owner_id: string;
  title: string;
  start_at: string;
  end_at: string;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  notes: string | null;
  status: AppointmentStatus;
  calendar_event_id: string | null;
  calendar_sync_status: CalendarSyncStatus;
  calendar_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToAppointment(row: ScheduledAppointmentRow): ScheduledAppointment {
  return {
    id: row.id,
    dealId: row.deal_id,
    ownerId: row.owner_id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    locationAddress: row.location_address,
    locationLat: row.location_lat,
    locationLng: row.location_lng,
    notes: row.notes,
    status: row.status,
    calendarEventId: row.calendar_event_id,
    calendarSyncStatus: row.calendar_sync_status,
    calendarSyncError: row.calendar_sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
