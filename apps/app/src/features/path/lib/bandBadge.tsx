/**
 * Shared band badge — the one band vocabulary used on every surface (Activities,
 * Path, Find Near Me), per the Screen Content Spec's cross-screen rule. Exactly
 * four labels a rep ever reads: In window, Past ideal, Aging, Promised. A task in
 * the future (not_yet_open) shows a neutral "Upcoming" and never one of the four.
 */
import { cn } from "@/lib/utils";
import type { BandPosition } from "./classD";

export const BAND_BADGE: Record<BandPosition, { label: string; className: string }> = {
  pinned: { label: "Promised", className: "bg-accent-violet-20 text-accent-violet" },
  aging: { label: "Aging", className: "bg-status-danger-bg text-status-danger" },
  past_ideal: { label: "Past ideal", className: "bg-status-warning-bg text-status-warning" },
  in_window: { label: "In window", className: "bg-status-info-bg text-status-info" },
  not_yet_open: { label: "Upcoming", className: "bg-surface-sunken text-text-muted" },
};

export function BandBadge({ band, className }: { band: BandPosition; className?: string }) {
  const b = BAND_BADGE[band];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-radius-full px-2 py-0.5 text-caption font-medium",
        b.className,
        className,
      )}
    >
      {b.label}
    </span>
  );
}
