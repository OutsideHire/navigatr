/**
 * navigatr DispositionTile — large tap target for selecting call/drop-in outcomes.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 60:88 (4 variants: tier =
 * positive | neutral | negative | cool).
 *
 *   All variants: 160 × 130 · radius/md (10) · surface/elevated fill ·
 *                 border/subtle 1 px stroke
 *   4 px band on left edge, fill = tier color:
 *     positive  status/success
 *     neutral   status/warning
 *     negative  status/danger
 *     cool      text/subtle
 *   Title:        body/strong, text/default
 *   Description:  caption, text/muted
 *
 * Selected state (code-only — Figma doesn't define it but the playbook
 * specifies): border-brand-primary 2 px + bg-brand-primary-10 tint.
 *
 * Used in the Drop-In disposition picker (10 tiles, 2-column grid) and
 * Call disposition picker (4 tiles).
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export type DispositionTier = "positive" | "neutral" | "negative" | "cool";

const bandColor: Record<DispositionTier, string> = {
  positive: "bg-status-success",
  neutral: "bg-status-warning",
  negative: "bg-status-danger",
  cool: "bg-text-subtle",
};

export interface DispositionTileProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  tier: DispositionTier;
  title: string;
  description: string;
  selected?: boolean;
}

export const DispositionTile = React.forwardRef<HTMLButtonElement, DispositionTileProps>(
  function DispositionTile(
    { tier, title, description, selected = false, disabled, className, type = "button", onClick, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          // Figma dims: 160 × 130. Use min-h to allow vertical growth on
          // longer descriptions; min-w-0 + flex-1 in callers handles wrap.
          "group relative flex min-h-[130px] w-full flex-col items-stretch overflow-hidden text-left",
          "rounded-radius-md transition-all",
          "bg-surface-elevated shadow-card",
          // Border: 1 px subtle by default, 2 px brand-primary when selected
          selected
            ? "border-2 border-brand-primary bg-brand-primary-10"
            : "border border-border-subtle hover:shadow-card-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...rest}
      >
        {/* Band — 4 px wide, full height, flush left */}
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-1", bandColor[tier])}
        />

        <div className="flex flex-col gap-1 px-4 py-4 pl-5">
          <span className="text-body-strong text-text-default">{title}</span>
          <span className="text-caption text-text-muted">{description}</span>
        </div>
      </button>
    );
  },
);
DispositionTile.displayName = "DispositionTile";

export default DispositionTile;
