/**
 * navigatr CardWithStatusBand — Card with a 4 px colored band on the left edge.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 49:37 (5 variants: band=
 * success|warning|danger|info|brand).
 *
 *   320 × HUG · HORIZONTAL auto-layout · no outer gap/padding
 *   Card body: `surface/default` fill, `border/subtle` 1 px stroke, `radius/md`
 *   Shadow: same as Card rest (`shadow-card`)
 *   Band: 4 × full-height RECTANGLE, fill = matching token
 *
 *   Internal content frame holds its own padding (16 all sides), so total
 *   visual padding from the band to the text is 4 + 16 = 20 px.
 *
 * Drift flagged: Figma defines 5 band colors. The user-facing prop also
 * exposes 5 accent variants (teal, violet, orange, blue, pink) using the
 * existing accent color tokens. Those 5 are **not in the Figma component
 * set yet** — same pattern as the Button's gradient style: tokens exist,
 * variant doesn't. Reverse-import action: add the accent bands to 49:37.
 *
 * Heavy users (per kickoff brief):
 *   - Pipeline deal cards (band by stage)
 *   - Partner cards (band by follow-up status)
 *   - Path method cards (band by method type)
 *   - Integration tiles (band by connection status)
 *   - Today's Tasks (band by activity type)
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, type CardProps } from "./Card";

// ---------------------------------------------------------------------------
// Band color → Tailwind background class
// ---------------------------------------------------------------------------

export type BandColor =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "brand"
  // Code-only — not in Figma component set 49:37 yet. Tokens exist in
  // figma-export.json under accent/*.
  | "teal"
  | "violet"
  | "orange"
  | "blue"
  | "pink";

const bandColorClass: Record<BandColor, string> = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  info: "bg-status-info",
  brand: "bg-brand-primary",
  teal: "bg-accent-teal",
  violet: "bg-accent-violet",
  orange: "bg-accent-orange",
  blue: "bg-accent-blue",
  pink: "bg-accent-pink",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CardWithStatusBandProps
  extends Omit<CardProps, "padding"> {
  /** Color of the 4 px left-edge band. */
  bandColor: BandColor;
  /** Reserved — future Figma `top` band variant. Only `left` is implemented. */
  bandPosition?: "left";
  /** Padding for the *content* area (inside the band). Defaults to `md` (16). */
  contentPadding?: CardProps["padding"];
}

export const CardWithStatusBand = React.forwardRef<HTMLElement, CardWithStatusBandProps>(
  function CardWithStatusBand(
    {
      bandColor,
      bandPosition: _bandPosition = "left",
      contentPadding = "md",
      className,
      children,
      ...cardProps
    },
    ref,
  ) {
    // Strategy: render a single Card with padding=none, then split its
    // interior into a band column + content column via flex. The Card itself
    // owns the shadow, border, radius, surface, and interactive behavior;
    // we only deviate in padding (handled inside).
    //
    // Using `overflow-hidden` on the Card so the band's edges meet the
    // Card's rounded corners cleanly (otherwise the band would render
    // outside the radius and look like an awkward tab).
    return (
      <Card
        ref={ref}
        padding="none"
        className={cn("overflow-hidden", className)}
        {...cardProps}
      >
        <div className="flex">
          <div
            className={cn("w-1 shrink-0 self-stretch", bandColorClass[bandColor])}
            aria-hidden
          />
          <div
            className={cn(
              "min-w-0 flex-1",
              contentPadding === "none" && "p-0",
              contentPadding === "sm" && "p-3",
              contentPadding === "md" && "p-4",
              contentPadding === "lg" && "p-5",
              contentPadding === "xl" && "p-6",
            )}
          >
            {children}
          </div>
        </div>
      </Card>
    );
  },
);
CardWithStatusBand.displayName = "CardWithStatusBand";

export default CardWithStatusBand;
