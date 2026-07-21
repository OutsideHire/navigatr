import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { usePartnerFollowUpReminders } from "./usePartnerFollowUpReminders";
import type { Partner } from "../mockData";

let partnersData: Partner[] = [];
vi.mock("./usePartners", () => ({
  usePartners: () => ({ data: partnersData, isLoading: false }),
}));

function partner(overrides: Partial<Partner>): Partner {
  return {
    id: "p", name: "N", company: "C", type: "cpa_bookkeeper", status: "active",
    phone: "", email: "", city: "", lastTouch: null, nextFollowup: null,
    attributedDealIds: [], outboundDealIds: [], notes: "",
    createdAt: "2020-01-01T12:00:00Z",
    ...overrides,
  };
}

beforeEach(() => { partnersData = []; });

describe("usePartnerFollowUpReminders", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");

  it("partitions overdue vs due-today and ignores no-cadence + upcoming", () => {
    partnersData = [
      partner({ id: "overdue", followupCadenceDays: 30, lastTouch: "2026-06-01T12:00:00Z" }),   // due Jul 1 → overdue
      partner({ id: "today", followupCadenceDays: 30, lastTouch: "2026-06-20T12:00:00Z" }),      // due Jul 20 → today
      partner({ id: "upcoming", followupCadenceDays: 30, lastTouch: "2026-07-18T12:00:00Z" }),   // future
      partner({ id: "nocadence", followupCadenceDays: null, lastTouch: "2020-01-01T12:00:00Z" }),
    ];
    const { result } = renderHook(() => usePartnerFollowUpReminders(now));
    expect(result.current.overdue.map((r) => r.id)).toEqual(["overdue"]);
    expect(result.current.today.map((r) => r.id)).toEqual(["today"]);
    expect(result.current.count).toBe(2);
  });
});
