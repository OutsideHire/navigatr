/**
 * navigatr Badge — canonical small status/category indicator.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 24:26 (12 variants, axis `kind`).
 * `stage-submitted` is code-only (added for the 'submitted' deal stage,
 * addendum 3.3.B.12), not yet in the Figma component set.
 *
 *   All variants: 22 px tall · padding 3 / 8 · radius/full · caption text
 *
 *   kind                fill                  text
 *   stage-new           status/info-bg        status/info
 *   stage-contacted     status/warning-bg     status/warning
 *   stage-qualified     accent/teal-20        accent/teal
 *   stage-proposal      accent/violet-20      accent/violet
 *   stage-submitted     accent/blue-20        accent/blue
 *   stage-won           status/success-bg     status/success
 *   status-overdue      status/danger-bg      status/danger
 *   status-due-soon     status/warning-bg     status/warning
 *   status-on-track     status/success-bg     status/success
 *   status-upcoming     status/info-bg        status/info
 *   priority-high       status/danger-bg      status/danger
 *   priority-medium     status/warning-bg     status/warning
 *   priority-low        surface/sunken        text/muted
 *
 * Sizes:
 *   md (default) — Figma canonical (22 px tall, py-0.5 px-2)
 *   sm           — extrapolated 18 px tall, py-0 px-1.5 — for dense tables
 *
 * `removable` is a code-only extension for filter-pill use cases — Figma
 * doesn't have a removable Badge variant. Pattern parallels Chip.
 */

import * as React from "react";
import { X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type BadgeKind =
  | "stage-new"
  | "stage-contacted"
  | "stage-qualified"
  | "stage-proposal"
  | "stage-submitted"
  | "stage-won"
  | "status-overdue"
  | "status-due-soon"
  | "status-on-track"
  | "status-upcoming"
  | "priority-high"
  | "priority-medium"
  | "priority-low";

const kindClasses: Record<BadgeKind, string> = {
  "stage-new":        "bg-status-info-bg text-status-info",
  "stage-contacted":  "bg-status-warning-bg text-status-warning",
  "stage-qualified":  "bg-accent-teal-20 text-accent-teal",
  "stage-proposal":   "bg-accent-violet-20 text-accent-violet",
  "stage-submitted":  "bg-accent-blue-20 text-accent-blue",
  "stage-won":        "bg-status-success-bg text-status-success",
  "status-overdue":   "bg-status-danger-bg text-status-danger",
  "status-due-soon":  "bg-status-warning-bg text-status-warning",
  "status-on-track":  "bg-status-success-bg text-status-success",
  "status-upcoming":  "bg-status-info-bg text-status-info",
  "priority-high":    "bg-status-danger-bg text-status-danger",
  "priority-medium":  "bg-status-warning-bg text-status-warning",
  "priority-low":     "bg-surface-sunken text-text-muted",
};

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "title"> {
  kind: BadgeKind;
  size?: "sm" | "md";
  leadingIcon?: LucideIcon;
  removable?: boolean;
  onRemove?: () => void;
  children: React.ReactNode;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { kind, size = "md", leadingIcon: LeadingIcon, removable = false, onRemove, className, children, ...rest },
  ref,
) {
  // Figma 24:26 exact: md 22 px, sm 18 px. Earlier session bumped these to
  // 24 / 20 as a band-aid for what looked like cramped vertical breathing —
  // but the actual bug was tailwind-merge stripping `text-caption`, making
  // the text render at 16 px (default body) inside a 22 px pill. Once
  // text-caption applies correctly (12 / 16), Figma's 22 px is back to
  // looking right.
  //
  // `leading-none` collapses the line-height so descenders don't push
  // against the pill's bottom edge — still useful even with correct font-size.
  const sizeCls = size === "sm"
    ? "h-[18px] gap-1 px-1.5 text-[10px] leading-none"
    : "h-[22px] gap-1 px-2 text-caption leading-none";

  const iconCls = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-radius-full font-medium",
        sizeCls,
        kindClasses[kind],
        className,
      )}
      {...rest}
    >
      {LeadingIcon && <LeadingIcon className={iconCls} aria-hidden />}
      {children}
      {removable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          aria-label="Remove"
          className={cn(
            "inline-flex items-center justify-center rounded-radius-full",
            "hover:bg-text-default/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
            iconCls,
            "ml-0.5",
          )}
        >
          <X className={iconCls} aria-hidden />
        </button>
      )}
    </span>
  );
});
Badge.displayName = "Badge";

export default Badge;
