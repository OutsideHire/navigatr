/**
 * Shared tier styling for the Path stop tiers (appointment / past-due /
 * due-today / nearby). Single source of truth so every surface that renders a
 * tiered stop list (the entry proposal in TodaysPathView, the consolidated
 * Stops tab in ActivePathView, and the SP-C3 Run view) reads the SAME per-tier
 * accent classes (badge circle + appointment border). No chip label: rows now
 * show a single plain reason line, not tier chips. Extracted from
 * TodaysPathView so the styling never drifts between surfaces.
 *
 * Past-due is warning-toned (work you owe), appointments violet (calendar-
 * owned), due-today brand-tinted, nearby neutral.
 */
import type { StopTier } from "./todaysPath";

/** Accent classes per tier so the plan reads at a glance. */
export function tierAccent(tier: StopTier): { chip: string; border: string; icon: string } {
  switch (tier) {
    case "appointment":
      return {
        chip: "bg-accent-violet-20 text-accent-violet",
        border: "border-accent-violet/40 bg-accent-violet-20",
        icon: "bg-accent-violet-20 text-accent-violet",
      };
    case "past_due":
      return {
        chip: "bg-status-warning-bg text-status-warning",
        border: "border-status-warning/40",
        icon: "bg-status-warning-bg text-status-warning",
      };
    case "due_today":
      return {
        chip: "bg-brand-primary-10 text-brand-primary",
        border: "border-border-subtle",
        icon: "bg-brand-primary-10 text-brand-primary",
      };
    case "nearby":
      return {
        chip: "bg-surface-sunken text-text-muted",
        border: "border-border-subtle",
        icon: "bg-surface-sunken text-text-muted",
      };
  }
}
