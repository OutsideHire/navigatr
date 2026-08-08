import { describe, it, expect } from "vitest";
import {
  assembleMeetingStops,
  type MeetingStopAppointment,
  type MeetingStopWaypoint,
} from "./meetingStops";

/** A scheduled navigatr appointment at 10:00, located, on a deal. */
const apptAt10: MeetingStopAppointment = {
  id: "appt-1",
  dealId: "deal-1",
  dealName: "Acme Co",
  title: "Acme demo",
  startAt: "2026-08-08T10:00:00Z",
  endAt: "2026-08-08T11:00:00Z",
  locationAddress: "1 Main St",
  locationLat: 40.1,
  locationLng: -74.1,
  calendarEventId: "cal-appt-1",
};

/** An external located calendar meeting at 09:00 (earlier than the appt). */
const externalAt9: MeetingStopWaypoint = {
  id: "wp-9",
  title: "Dentist",
  start: "2026-08-08T09:00:00Z",
  end: "2026-08-08T09:30:00Z",
  address: "22 Oak Ave",
  lat: 41.0,
  lng: -75.0,
};

const NOW = "2026-08-08T08:00:00Z"; // before both events → nothing is past

describe("assembleMeetingStops", () => {
  it("interleaves appointment and external stops in ascending time order", () => {
    const stops = assembleMeetingStops([apptAt10], [externalAt9], NOW);
    expect(stops.map((s) => s.id)).toEqual(["wp-9", "appt-1"]);
    expect(stops[0]).toMatchObject({
      kind: "external",
      title: "Dentist",
      dealId: null,
      dealName: null,
      appointmentId: null,
      lat: 41.0,
      lng: -75.0,
      address: "22 Oak Ave",
    });
    expect(stops[1]).toMatchObject({
      kind: "appointment",
      title: "Acme demo",
      dealId: "deal-1",
      dealName: "Acme Co",
      appointmentId: "appt-1",
      lat: 40.1,
      lng: -74.1,
      address: "1 Main St",
    });
  });

  it("de-dups: an external waypoint that mirrors an appointment (by calendarEventId) is dropped", () => {
    // The waypoint's id IS the mirrored calendar event id the appointment points at.
    const mirror: MeetingStopWaypoint = {
      id: "cal-appt-1",
      title: "Acme demo (from Google)",
      start: "2026-08-08T10:00:00Z",
      end: "2026-08-08T11:00:00Z",
      address: "1 Main St",
      lat: 40.1,
      lng: -74.1,
    };
    const stops = assembleMeetingStops([apptAt10], [mirror], NOW);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ kind: "appointment", appointmentId: "appt-1" });
  });

  it("de-dups via an explicit navigatrAppointmentId when the waypoint carries one", () => {
    const mirror: MeetingStopWaypoint = {
      id: "wp-x",
      title: "Acme demo (mirror)",
      start: "2026-08-08T10:00:00Z",
      end: "2026-08-08T11:00:00Z",
      address: "1 Main St",
      lat: 40.1,
      lng: -74.1,
      navigatrAppointmentId: "appt-1",
    };
    const stops = assembleMeetingStops([apptAt10], [mirror], NOW);
    expect(stops).toHaveLength(1);
    expect(stops[0].kind).toBe("appointment");
  });

  it("keeps a located external that matches no appointment", () => {
    const stops = assembleMeetingStops([], [externalAt9], NOW);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ kind: "external", id: "wp-9", appointmentId: null });
  });

  it("excludes an external with no usable location", () => {
    const noLoc: MeetingStopWaypoint = {
      id: "wp-noloc",
      title: "Phone call",
      start: "2026-08-08T09:00:00Z",
      end: "2026-08-08T09:15:00Z",
      address: null,
      lat: null,
      lng: null,
    };
    const stops = assembleMeetingStops([], [noLoc], NOW);
    expect(stops).toHaveLength(0);
  });

  it("sets past=true when the stop's end (or start) is before nowIso", () => {
    // now is after externalAt9's end (09:30) but before apptAt10's end (11:00).
    const now = "2026-08-08T10:30:00Z";
    const stops = assembleMeetingStops([apptAt10], [externalAt9], now);
    const external = stops.find((s) => s.id === "wp-9")!;
    const appt = stops.find((s) => s.id === "appt-1")!;
    expect(external.past).toBe(true);
    expect(appt.past).toBe(false);
  });

  it("falls back to startAt for the past check when endAt is null", () => {
    const noEnd: MeetingStopAppointment = {
      ...apptAt10,
      id: "appt-noend",
      endAt: null,
      startAt: "2026-08-08T07:00:00Z",
      calendarEventId: null,
    };
    const stops = assembleMeetingStops([noEnd], [], NOW); // NOW=08:00, start=07:00
    expect(stops[0].past).toBe(true);
    expect(stops[0].endAt).toBeNull();
  });

  it("maps an appointment with no location to null coords (still a stop)", () => {
    const noLocAppt: MeetingStopAppointment = {
      ...apptAt10,
      id: "appt-noloc",
      locationAddress: null,
      locationLat: null,
      locationLng: null,
    };
    const stops = assembleMeetingStops([noLocAppt], [], NOW);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ kind: "appointment", lat: null, lng: null, address: null });
  });

  it("returns [] for empty inputs", () => {
    expect(assembleMeetingStops([], [], NOW)).toEqual([]);
  });

  it("defaults dealName to null when the appointment carries no name", () => {
    const noName: MeetingStopAppointment = { ...apptAt10, dealName: undefined };
    const stops = assembleMeetingStops([noName], [], NOW);
    expect(stops[0].dealName).toBeNull();
  });
});
