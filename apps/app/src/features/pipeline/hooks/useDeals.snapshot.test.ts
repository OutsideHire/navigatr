import { describe, it, expect } from "vitest";
import { toDeal } from "./useDeals";

describe("toDeal — Activity-to-Win snapshot fields", () => {
  const base = {
    id: "d1", company_name: "Acme", contact_name: "C", contact_phone: "", contact_email: "",
    value_cents: 50_000_00, stage: "won" as const, probability: 100,
    last_activity_at: null, next_followup_at: null, address: null,
    employee_count_range: null, lead_source: null, updated_at: "2026-06-01T00:00:00.000Z",
    owner_id: "u1", lost_reason_category: null, lost_reason_notes: null,
  };

  it("maps snake_case snapshot columns to camelCase Deal fields", () => {
    const deal = toDeal({
      ...base,
      closed_won_at: "2026-06-15T00:00:00.000Z",
      first_activity_at: "2026-06-01T00:00:00.000Z",
      activity_count_total: 12,
      activity_count_call: 7,
      activity_count_email: 3,
      activity_count_dropin: 2,
      activity_count_appointment: 0,
      time_to_win_business_days: 10,
      time_to_win_calendar_days: 14,
      industry: "retail",
    });
    expect(deal.closedWonAt).toBe("2026-06-15T00:00:00.000Z");
    expect(deal.firstActivityAt).toBe("2026-06-01T00:00:00.000Z");
    expect(deal.activityCountTotal).toBe(12);
    expect(deal.activityCountCall).toBe(7);
    expect(deal.activityCountEmail).toBe(3);
    expect(deal.activityCountDropin).toBe(2);
    expect(deal.activityCountAppointment).toBe(0);
    expect(deal.timeToWinBusinessDays).toBe(10);
    expect(deal.timeToWinCalendarDays).toBe(14);
    expect(deal.industry).toBe("retail");
  });

  it("maps absent snapshot columns to null (open / legacy rows)", () => {
    const deal = toDeal(base);
    expect(deal.closedWonAt).toBeNull();
    expect(deal.firstActivityAt).toBeNull();
    expect(deal.activityCountTotal).toBeNull();
    expect(deal.timeToWinBusinessDays).toBeNull();
    expect(deal.industry).toBeNull();
  });
});
