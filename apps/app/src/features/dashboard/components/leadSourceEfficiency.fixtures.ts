import type { LeadSourceEfficiencyDatum } from "./LeadSourceEfficiency";

/** Primary fixture (spec §11): realistic 180-day rep-sourced case. Produces the
 *  diagonal spread the panel exists to show (Path/Canvass bottom-right, Partner/
 *  Customer/Inbound upper-left). */
export const leadSourceEfficiencyFixture: LeadSourceEfficiencyDatum[] = [
  { sourceId: "path", label: "Path", shortLabel: "PATH", color: "#8A72F2", leads: 4180, wonDeals: 121, winRate: 2.9, touchesToWin: 7.4, belowFloor: false },
  { sourceId: "self_sourced_canvass", label: "Self sourced canvass", shortLabel: "CANVASS", color: "#B48CF5", leads: 1240, wonDeals: 43, winRate: 3.5, touchesToWin: 6.9, belowFloor: false },
  { sourceId: "partner_referral", label: "Partner referral", shortLabel: "PARTNER", color: "#2E5FE2", leads: 386, wonDeals: 79, winRate: 20.5, touchesToWin: 4.1, belowFloor: false },
  { sourceId: "customer_referral", label: "Customer referral", shortLabel: "CUSTOMER", color: "#5B8CF5", leads: 214, wonDeals: 51, winRate: 23.8, touchesToWin: 3.6, belowFloor: false },
  { sourceId: "event_association", label: "Event and association", shortLabel: "EVENT", color: "#D9A5F0", leads: 302, wonDeals: 28, winRate: 9.3, touchesToWin: 5.8, belowFloor: false },
  { sourceId: "inbound", label: "Inbound", shortLabel: "INBOUND", color: "#86AEF8", leads: 96, wonDeals: 19, winRate: 19.8, touchesToWin: 3.1, belowFloor: false },
  { sourceId: "other", label: "Other", shortLabel: "OTHER", color: "#8E90A8", leads: 74, wonDeals: 6, winRate: 8.1, touchesToWin: 5.5, belowFloor: false },
];

/** §9 item 3: rows exist, nothing closed won. Most common beta state. */
export const efficiencyNoClosedWonFixture: LeadSourceEfficiencyDatum[] = [
  { sourceId: "path", label: "Path", shortLabel: "PATH", color: "#8A72F2", leads: 820, wonDeals: 0, winRate: 0, touchesToWin: 0, belowFloor: true },
  { sourceId: "partner_referral", label: "Partner referral", shortLabel: "PARTNER", color: "#2E5FE2", leads: 44, wonDeals: 0, winRate: 0, touchesToWin: 0, belowFloor: true },
];

/** §9 item 4: some sources have no wins (omitted from the plot, listed below). */
export const efficiencyPartialFixture: LeadSourceEfficiencyDatum[] = [
  { sourceId: "path", label: "Path", shortLabel: "PATH", color: "#8A72F2", leads: 900, wonDeals: 40, winRate: 4.4, touchesToWin: 6.2, belowFloor: false },
  { sourceId: "partner_referral", label: "Partner referral", shortLabel: "PARTNER", color: "#2E5FE2", leads: 120, wonDeals: 22, winRate: 18.3, touchesToWin: 3.9, belowFloor: false },
  { sourceId: "inbound", label: "Inbound", shortLabel: "INBOUND", color: "#86AEF8", leads: 60, wonDeals: 0, winRate: 0, touchesToWin: 0, belowFloor: true },
  { sourceId: "other", label: "Other", shortLabel: "OTHER", color: "#8E90A8", leads: 30, wonDeals: 0, winRate: 0, touchesToWin: 0, belowFloor: true },
];

/** §9 item 5: every source below the 5-deal floor → reference line suppressed. */
export const efficiencyAllBelowFloorFixture: LeadSourceEfficiencyDatum[] = [
  { sourceId: "partner_referral", label: "Partner referral", shortLabel: "PARTNER", color: "#2E5FE2", leads: 40, wonDeals: 3, winRate: 7.5, touchesToWin: 4.0, belowFloor: true },
  { sourceId: "customer_referral", label: "Customer referral", shortLabel: "CUSTOMER", color: "#5B8CF5", leads: 22, wonDeals: 2, winRate: 9.1, touchesToWin: 3.4, belowFloor: true },
  { sourceId: "event_association", label: "Event and association", shortLabel: "EVENT", color: "#D9A5F0", leads: 18, wonDeals: 1, winRate: 5.6, touchesToWin: 5.1, belowFloor: true },
];

/** §9 item 6: one source. Both scale collapses guarded; reference line suppressed. */
export const efficiencySingleFixture: LeadSourceEfficiencyDatum[] = [
  { sourceId: "path", label: "Path", shortLabel: "PATH", color: "#8A72F2", leads: 900, wonDeals: 60, winRate: 5.2, touchesToWin: 6.4, belowFloor: false },
];

/** §9 item 8: all sources share one touch count → x-scale degenerate guard. */
export const efficiencyIdenticalTouchFixture: LeadSourceEfficiencyDatum[] = [
  { sourceId: "path", label: "Path", shortLabel: "PATH", color: "#8A72F2", leads: 400, wonDeals: 30, winRate: 6.0, touchesToWin: 5.0, belowFloor: false },
  { sourceId: "partner_referral", label: "Partner referral", shortLabel: "PARTNER", color: "#2E5FE2", leads: 120, wonDeals: 22, winRate: 15.0, touchesToWin: 5.0, belowFloor: false },
  { sourceId: "inbound", label: "Inbound", shortLabel: "INBOUND", color: "#86AEF8", leads: 60, wonDeals: 12, winRate: 12.0, touchesToWin: 5.0, belowFloor: false },
];
