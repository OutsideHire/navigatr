import { describe, it, expect } from "vitest";
import { merchantFromStop } from "./merchantFromStop";
import type { TodayStop } from "../hooks/useTodayPath";

const STOP: TodayStop = {
  merchantId: "m1", name: "Acme", address: "1 Main St", lat: 35, lng: -97,
  category: "manufacturing", primaryType: "metal_supplier", phone: "+15551234567",
  status: "pending", disposition: null, dealCreated: false, addedAt: "t1",
};

describe("merchantFromStop", () => {
  it("builds a Merchant from a stop snapshot (id, name, address, phone, category)", () => {
    const m = merchantFromStop(STOP);
    expect(m.id).toBe("m1");
    expect(m.name).toBe("Acme");
    expect(m.address).toBe("1 Main St");
    expect(m.phone).toBe("+15551234567");
    expect(m.category).toBe("manufacturing");
  });
  it("tolerates null address/phone", () => {
    const m = merchantFromStop({ ...STOP, address: null, phone: null });
    expect(m.address).toBe("");
    expect(m.phone).toBe("");
  });
});
