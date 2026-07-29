/**
 * Presentation helpers for the Persistence Index report re-style (prototype
 * a3ffcd58). Pure + tested: the ticker codes (TEAM-SW / PIX-JB) and the boxed
 * readout figures (range delta, percent, and the "from to" date labels) live
 * here so the page just renders them.
 */
import type { PersistencePoint } from "./persistenceIndex";

/**
 * A ticker-style code from a person/team name: `${prefix}-${first+last initial}`.
 * "Sarah Williams","TEAM" -> "TEAM-SW"; "Jamal Brooks","PIX" -> "PIX-JB". Falls
 * back to just the prefix when no usable letters are present.
 */
export function initialsCode(name: string, prefix: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  const code = (first + last).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code ? `${prefix}-${code}` : prefix;
}

export interface RangeReadout {
  /** Latest scored composite in the range (the big number), or null. */
  latest: number | null;
  /** Change across the range (last scored - first scored), or null. */
  delta: number | null;
  /** Percent change vs the first scored value, or null (no baseline). */
  pct: number | null;
  /** "MMM D" label for the first / last scored point, or null. */
  fromLabel: string | null;
  toLabel: string | null;
}

function fmtDay(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The boxed-readout figures from a daily series (ignores null-composite days). */
export function rangeReadout(points: PersistencePoint[]): RangeReadout {
  const scored = points.filter((p) => p.composite != null);
  if (scored.length === 0) return { latest: null, delta: null, pct: null, fromLabel: null, toLabel: null };
  const first = scored[0]!;
  const last = scored[scored.length - 1]!;
  const firstVal = first.composite as number;
  const lastVal = last.composite as number;
  const delta = lastVal - firstVal;
  const pct = firstVal !== 0 ? (delta / firstVal) * 100 : null;
  return { latest: lastVal, delta, pct, fromLabel: fmtDay(first.date), toLabel: fmtDay(last.date) };
}

/** "+4.4 (+6.2%)" / "-10.1 (-14.8%)" from a readout; "" when no delta. */
export function formatReadoutDelta(r: RangeReadout): string {
  if (r.delta == null) return "";
  const d = `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)}`;
  if (r.pct == null) return d;
  return `${d} (${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%)`;
}

/** "3M range · Apr 26 to Jul 24" (or just the range key when dates are absent). */
export function formatRangeLabel(rangeKey: string, r: RangeReadout): string {
  if (r.fromLabel && r.toLabel) return `${rangeKey} range · ${r.fromLabel} to ${r.toLabel}`;
  return `${rangeKey} range`;
}
