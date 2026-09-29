import { describe, it, expect } from "vitest";
import { merchantFromStop } from "./merchantFromStop";
import type { TodayStop } from "../hooks/useTodayPath";

const STOP: TodayStop = {
  merchantId: "m1", name: "Acme", address: "1 Main St", lat: 35, lng: -97,
  category: "manufacturing_wholesale", primaryType: "metal_supplier", phone: "+15551234567",
  status: "pending", disposition: null, notes: null, dealCreated: false, addedAt: "t1",
};

describe("merchantFromStop", () => {
  it("builds a Merchant from a stop snapshot (id, name, address, phone, category)", () => {
    const m = merchantFromStop(STOP);
    expect(m.id).toBe("m1");
    expect(m.name).toBe("Acme");
    expect(m.address).toBe("1 Main St");
    expect(m.phone).toBe("+15551234567");
    expect(m.category).toBe("manufacturing_wholesale");
  });
  it("carries the place id through, so a drop-in logged while DRIVING can stamp it", () => {
    // The defect: the running view rebuilds its Merchant from the stop
    // snapshot, which had no place_id, so DropInSheet passed undefined and
    // every deal created from the driving carousel landed with place_id NULL.
    // That is the screen reps actually use, and place_id is the org-wide
    // de-dup anchor as well as the key any repair would join on.
    const m = merchantFromStop({ ...STOP, placeId: "ChIJ-driving-1" });
    expect(m.placeId).toBe("ChIJ-driving-1");
  });

  it("leaves placeId undefined for a stop added before the column existed", () => {
    const m = merchantFromStop({ ...STOP, placeId: null });
    expect(m.placeId).toBeUndefined();
  });

  it("tolerates null address/phone", () => {
    const m = merchantFromStop({ ...STOP, address: null, phone: null });
    expect(m.address).toBe("");
    expect(m.phone).toBe("");
  });
});
