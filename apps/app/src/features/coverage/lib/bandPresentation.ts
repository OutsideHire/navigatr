/**
 * SP2a presentation helpers — map a coverage band / confidence level to Tailwind
 * status tokens + human labels. The band MATH (composite → band) stays in the
 * shared _shared/coverage/score.ts; this is the frontend's token/label layer.
 */
import type { Band, ConfidenceLevel } from "../../../../../../supabase/functions/_shared/coverage/config";

export interface BandPresentation {
  label: string;
  /** text color utility for the % */
  tokenClass: string;
  /** background+text utilities for the band pill */
  pillClass: string;
  /** solid background utility for the trend sparkline bars (static so Tailwind keeps it) */
  barClass: string;
}

const BAND_PRESENTATION: Record<Band, BandPresentation> = {
  excellent:  { label: "Excellent",  tokenClass: "text-status-success", pillClass: "bg-status-success-bg text-status-success", barClass: "bg-status-success" },
  good:       { label: "Good",       tokenClass: "text-status-success", pillClass: "bg-status-success-bg text-status-success", barClass: "bg-status-success" },
  adequate:   { label: "Adequate",   tokenClass: "text-status-warning", pillClass: "bg-status-warning-bg text-status-warning", barClass: "bg-status-warning" },
  poor:       { label: "Poor",       tokenClass: "text-status-warning", pillClass: "bg-status-warning-bg text-status-warning", barClass: "bg-status-warning" },
  unreliable: { label: "Unreliable", tokenClass: "text-status-danger",  pillClass: "bg-status-danger-bg text-status-danger",  barClass: "bg-status-danger" },
};

export function bandPresentation(band: Band): BandPresentation {
  return BAND_PRESENTATION[band];
}

/** Confidence qualifier shown beside the %. `high` → no qualifier. */
export function confidenceLabel(level: ConfidenceLevel): string | null {
  switch (level) {
    case "high": return null;
    case "medium": return "Estimated";
    case "low": return "Estimated · low confidence";
    case "insufficient": return "Estimated · low confidence"; // defensive — insufficient renders the empty state
  }
}
