/**
 * Fixtures for LeadSourceFlow (Lead Source report "Signature View").
 * Synthetic, shaped to be realistic (no production data exists pre-beta).
 * `wonRevenue` is an opaque integer in minor units (cents). See the spec §10.
 */
import type { LeadSourceFlowDatum } from "./LeadSourceFlow";

/** §10 primary fixture — the realistic 180-day rep-sourced case. Produces the
 *  Path-vs-Partner-referral crossing the chart exists to show. */
export const leadSourceFlowFixture: LeadSourceFlowDatum[] = [
  { sourceId: "path", label: "Path", color: "#8A72F2", leads: 4180, wonRevenue: 14300000 },
  { sourceId: "self_sourced_canvass", label: "Self sourced canvass", color: "#B48CF5", leads: 1240, wonRevenue: 4515000 },
  { sourceId: "partner_referral", label: "Partner referral", color: "#2E5FE2", leads: 386, wonRevenue: 12956000 },
  { sourceId: "customer_referral", label: "Customer referral", color: "#5B8CF5", leads: 214, wonRevenue: 7242000 },
  { sourceId: "event_association", label: "Event and association", color: "#D9A5F0", leads: 302, wonRevenue: 3668000 },
  { sourceId: "inbound", label: "Inbound", color: "#86AEF8", leads: 96, wonRevenue: 2869000 },
  { sourceId: "other", label: "Other", color: "#8E90A8", leads: 74, wonRevenue: 588000 },
];

/** State: empty (zero rows). */
export const leadSourceFlowEmptyFixture: LeadSourceFlowDatum[] = [];

/** State: revenue not yet earned — leads exist, nothing has closed won. The most
 *  common state during beta. */
export const leadSourceFlowNoRevenueFixture: LeadSourceFlowDatum[] = [
  { sourceId: "path", label: "Path", color: "#8A72F2", leads: 820, wonRevenue: 0 },
  { sourceId: "self_sourced_canvass", label: "Self sourced canvass", color: "#B48CF5", leads: 240, wonRevenue: 0 },
  { sourceId: "partner_referral", label: "Partner referral", color: "#2E5FE2", leads: 63, wonRevenue: 0 },
];

/** State: one source has leads but no revenue (a channel consuming rep time and
 *  returning nothing) — its bottom segment and ribbon taper to a point. */
export const leadSourceFlowLeadsNoRevenueFixture: LeadSourceFlowDatum[] = [
  { sourceId: "path", label: "Path", color: "#8A72F2", leads: 900, wonRevenue: 0 },
  { sourceId: "partner_referral", label: "Partner referral", color: "#2E5FE2", leads: 120, wonRevenue: 6400000 },
  { sourceId: "customer_referral", label: "Customer referral", color: "#5B8CF5", leads: 90, wonRevenue: 3100000 },
];

/** State: revenue with no leads in window (possible under the won-in-period basis)
 *  — mirror of the above; top segment and ribbon taper upward to a point. */
export const leadSourceFlowRevenueNoLeadsFixture: LeadSourceFlowDatum[] = [
  { sourceId: "path", label: "Path", color: "#8A72F2", leads: 640, wonRevenue: 5200000 },
  { sourceId: "partner_referral", label: "Partner referral", color: "#2E5FE2", leads: 0, wonRevenue: 4100000 },
  { sourceId: "inbound", label: "Inbound", color: "#86AEF8", leads: 210, wonRevenue: 1800000 },
];

/** State: single source — both bands full width, one straight ribbon. */
export const leadSourceFlowSingleFixture: LeadSourceFlowDatum[] = [
  { sourceId: "path", label: "Path", color: "#8A72F2", leads: 512, wonRevenue: 9800000 },
];

/** State: long tail — 12 rows, several under 2% of both bands, so the component
 *  groups them into one "Other sources" row. */
export const leadSourceFlowLongTailFixture: LeadSourceFlowDatum[] = [
  { sourceId: "path", label: "Path", color: "#8A72F2", leads: 3800, wonRevenue: 11200000 },
  { sourceId: "self_sourced_canvass", label: "Self sourced canvass", color: "#B48CF5", leads: 1100, wonRevenue: 4200000 },
  { sourceId: "partner_referral", label: "Partner referral", color: "#2E5FE2", leads: 420, wonRevenue: 9800000 },
  { sourceId: "customer_referral", label: "Customer referral", color: "#5B8CF5", leads: 260, wonRevenue: 5100000 },
  { sourceId: "event_association", label: "Event and association", color: "#D9A5F0", leads: 300, wonRevenue: 2600000 },
  { sourceId: "inbound", label: "Inbound", color: "#86AEF8", leads: 140, wonRevenue: 1500000 },
  { sourceId: "other", label: "Other", color: "#8E90A8", leads: 90, wonRevenue: 300000 },
  // Small tail (each < 2% of both bands):
  { sourceId: "chamber", label: "Chamber of commerce", color: "#7FA7F5", leads: 40, wonRevenue: 120000 },
  { sourceId: "webinar", label: "Webinar", color: "#9C8AF0", leads: 32, wonRevenue: 90000 },
  { sourceId: "linkedin", label: "LinkedIn", color: "#A0B8F8", leads: 28, wonRevenue: 70000 },
  { sourceId: "walk_in", label: "Walk in", color: "#C4A2EE", leads: 22, wonRevenue: 60000 },
  { sourceId: "reactivation", label: "Reactivation", color: "#6F9BF2", leads: 18, wonRevenue: 40000 },
];

/** Three-source case for the acceptance matrix (1 / 3 / 7 / 12 sources). */
export const leadSourceFlowThreeFixture: LeadSourceFlowDatum[] = [
  { sourceId: "path", label: "Path", color: "#8A72F2", leads: 1200, wonRevenue: 6200000 },
  { sourceId: "partner_referral", label: "Partner referral", color: "#2E5FE2", leads: 300, wonRevenue: 8100000 },
  { sourceId: "self_sourced_canvass", label: "Self sourced canvass", color: "#B48CF5", leads: 540, wonRevenue: 2400000 },
];
