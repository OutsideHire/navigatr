/**
 * Recovering the Places detail a thin Merchant lost on its way to the drop-in.
 *
 * The bug, measured on staging 2026-09-29: three deals created from the driving
 * carousel had empty phone, empty address and null place_id, while the prospect
 * rows behind them held real addresses, two phone numbers and a website. The
 * driving view falls back to building a Merchant from a DrivingCard when no
 * saved stop matches, and a card carries only a name, an address and coords, so
 * that branch hardcodes phone: "" and sets no place id.
 */
import { describe, it, expect } from "vitest";
import { needsProspectFill, mergeProspectDetail } from "./prospectFill";
import { ADDRESS_UNAVAILABLE } from "../hooks/useMerchants";
import type { Merchant } from "../mockData";

/** What RunningPath's fallback actually produces from a DrivingCard. */
const thin: Merchant = {
  id: "prospect-1",
  name: "Godly treatz",
  category: "other",
  address: "",
  lat: 35.6,
  lng: -97.4,
  phone: "",
  employeeCountRange: "",
  status: "untouched",
  lastActivity: null,
  primaryType: null,
};

const row = {
  place_id: "ChIJKZLcB50fsocRJ6Bz_GyaaJg",
  address: "1700 Kickingbird Rd, Edmond, OK 73034, USA",
  phone: "(405) 341-5350",
  website: "http://www.thelookoutedmond.com/",
};

describe("needsProspectFill", () => {
  it("is true for the merchant the driving view builds from a card", () => {
    expect(needsProspectFill(thin)).toBe(true);
  });

  it("is false for a complete discovery merchant, so the common case pays nothing", () => {
    expect(needsProspectFill({
      ...thin, placeId: "ChIJ-x", address: "1 Main St", phone: "+15550001", website: "https://x.example",
    })).toBe(false);
  });

  it("does NOT trigger on a missing website alone", () => {
    // Most merchants have no website, so triggering on it would make nearly
    // every drop-in pay for a lookup that finds nothing new. Discovery already
    // reads website off the same row.
    expect(needsProspectFill({
      ...thin, placeId: "ChIJ-x", address: "1 Main St", phone: "+15550001",
    })).toBe(false);
  });

  it("treats the Path display stand-in as absent, not as an address", () => {
    expect(needsProspectFill({
      ...thin, placeId: "ChIJ-x", address: ADDRESS_UNAVAILABLE, phone: "+15550001", website: "https://x.example",
    })).toBe(true);
  });

  it("treats whitespace as absent", () => {
    expect(needsProspectFill({
      ...thin, placeId: "ChIJ-x", address: "   ", phone: "+15550001", website: "https://x.example",
    })).toBe(true);
  });
});

describe("mergeProspectDetail", () => {
  it("recovers everything the card could not carry", () => {
    const out = mergeProspectDetail(thin, row);
    expect(out.placeId).toBe(row.place_id);
    expect(out.address).toBe(row.address);
    expect(out.phone).toBe(row.phone);
    expect(out.website).toBe(row.website);
  });

  it("never overwrites what the merchant already has", () => {
    // A fresher card, or something a rep supplied, must win over the cache.
    const full: Merchant = { ...thin, placeId: "ChIJ-live", address: "9 Newer St", phone: "+15559999" };
    const out = mergeProspectDetail(full, row);
    expect(out.placeId).toBe("ChIJ-live");
    expect(out.address).toBe("9 Newer St");
    expect(out.phone).toBe("+15559999");
    // Still fills the one gap it had.
    expect(out.website).toBe(row.website);
  });

  it("replaces the display stand-in with the real address", () => {
    const out = mergeProspectDetail({ ...thin, address: ADDRESS_UNAVAILABLE }, row);
    expect(out.address).toBe(row.address);
  });

  it("returns the merchant untouched when there is no prospect row", () => {
    expect(mergeProspectDetail(thin, null)).toEqual(thin);
    expect(mergeProspectDetail(thin, undefined)).toEqual(thin);
  });

  it("leaves a gap a gap when the prospect has nothing for it either", () => {
    // Godly treatz really had no phone and no website in Places.
    const out = mergeProspectDetail(thin, { place_id: row.place_id, address: row.address, phone: null, website: null });
    expect(out.placeId).toBe(row.place_id);
    expect(out.address).toBe(row.address);
    expect(out.phone).toBe("");
    expect(out.website).toBeUndefined();
  });

  it("does not disturb the fields it has no business touching", () => {
    const out = mergeProspectDetail(thin, row);
    expect(out.id).toBe(thin.id);
    expect(out.name).toBe(thin.name);
    expect(out.lat).toBe(thin.lat);
    expect(out.lng).toBe(thin.lng);
  });
});
