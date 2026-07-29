/**
 * directReports — pure display logic for the Persistence Index "Direct reports"
 * table (SP-1 report rebuild). Kept pure + tested so the status thresholds,
 * sort order, and filtering live in one place and the table component just
 * renders rows.
 *
 * Data (composite, 30-day delta, activity count, trailing sparkline) is
 * assembled by the useDirectReports hook from the same client-side persistence
 * functions the report already uses; these helpers shape it for display.
 */

import { historyDelta, type PersistencePoint } from "./persistenceIndex";

export type DirectReportStatus = "trending_up" | "holding" | "needs_attention";

export interface DirectReportInput {
  ownerId: string;
  name: string;
  /** Role-level label (e.g. "Sales Professional"); null when unknown. */
  role: string | null;
  /** Composite index 0-100, or null when there is not enough data to score. */
  composite: number | null;
  /** Change over the trailing 30 days (last - first scored point), or null. */
  delta30: number | null;
  /** Count of the rep's logged activities in the reporting window. */
  activityCount: number;
  /** Trailing daily composite values for the sparkline (may be short/empty). */
  spark: number[];
}

export interface DirectReportRow extends DirectReportInput {
  status: DirectReportStatus;
}

export type DirectReportFilter = "all" | DirectReportStatus;

/**
 * Classify a rep's momentum from their 30-day delta. Thresholds calibrated to
 * the prototype's examples (+4.5 -> up, -1.0 -> holding, -6.3 -> needs
 * attention). A null delta (too little history to compute a change) is treated
 * as holding rather than alarming.
 */
export function directReportStatus(delta: number | null): DirectReportStatus {
  if (delta == null) return "holding";
  if (delta >= 2) return "trending_up";
  if (delta <= -3) return "needs_attention";
  return "holding";
}

/**
 * Attach status and sort for display: highest index first, reps with no score
 * (composite null) last, name ascending as a stable tiebreak.
 */
export function buildDirectReportRows(inputs: DirectReportInput[]): DirectReportRow[] {
  return inputs
    .map((r) => ({ ...r, status: directReportStatus(r.delta30) }))
    .sort((a, b) => {
      if (a.composite == null && b.composite == null) return a.name.localeCompare(b.name);
      if (a.composite == null) return 1; // nulls last
      if (b.composite == null) return -1;
      if (b.composite !== a.composite) return b.composite - a.composite; // index desc
      return a.name.localeCompare(b.name);
    });
}

/** Filter rows by the active status pill. "all" passes everything through. */
export function filterDirectReports(rows: DirectReportRow[], filter: DirectReportFilter): DirectReportRow[] {
  if (filter === "all") return rows;
  return rows.filter((r) => r.status === filter);
}

// ── Assembly (pure; the hook injects the per-rep history provider) ─────────

/** Minimal shapes the assembler needs (Deal/Activity are structurally wider). */
interface DealLike {
  id: string;
  owner_id: string | null;
}
interface ActivityLike {
  dealId: string;
  occurredAt: string; // ISO
}

export interface AssembleDirectReportsParams {
  /** Per-rep composite scores (computePerRepPersistence output shape). */
  roster: { ownerId: string; composite: number | null }[];
  deals: DealLike[];
  activities: ActivityLike[];
  /** id -> display name + role label, for the rep cell. */
  members: Map<string, { name: string; role: string | null }>;
  /** Trailing daily composite series for a rep (newest last), length ~windowDays.
   *  Injected so the assembler stays pure; the hook wraps computePersistenceHistory. */
  historyFor: (ownerId: string) => PersistencePoint[];
  now: Date;
  /** Trailing window for the sparkline + activity count. Default 60 days. */
  windowDays?: number;
}

/**
 * Build the unsorted per-rep table inputs: composite (from roster), 30-day
 * delta and trailing sparkline (from the injected history series), and the
 * activity count over the trailing window (activities on deals the rep owns,
 * matching how scoring attributes to the deal owner). Sorting + status live in
 * buildDirectReportRows.
 */
export function assembleDirectReportInputs(params: AssembleDirectReportsParams): DirectReportInput[] {
  const windowDays = params.windowDays ?? 60;
  const cutoff = params.now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  // Deal -> owner, so activities (which link to a deal) attribute to the owner.
  const ownerByDeal = new Map<string, string>();
  for (const d of params.deals) {
    if (d.owner_id != null) ownerByDeal.set(d.id, d.owner_id);
  }
  const activityCountByOwner = new Map<string, number>();
  for (const a of params.activities) {
    const t = new Date(a.occurredAt).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    const owner = ownerByDeal.get(a.dealId);
    if (owner == null) continue;
    activityCountByOwner.set(owner, (activityCountByOwner.get(owner) ?? 0) + 1);
  }

  return params.roster.map((rep) => {
    const series = params.historyFor(rep.ownerId);
    // 30-day delta = change across the last 30 daily points of the window.
    const delta30 = historyDelta(series.slice(-30));
    const spark = series
      .map((p) => p.composite)
      .filter((v): v is number => v != null);
    const member = params.members.get(rep.ownerId);
    return {
      ownerId: rep.ownerId,
      name: member?.name ?? "Unknown rep",
      role: member?.role ?? null,
      composite: rep.composite,
      delta30,
      activityCount: activityCountByOwner.get(rep.ownerId) ?? 0,
      spark,
    };
  });
}
