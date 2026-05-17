/**
 * navigatr LogoMark — the "Roberts" filled-compass + diamond mark.
 *
 * Source: navigatr brand pack v3 (Roberts variant). Filled north/south
 * needles, blue accent, diamond "rose" at center, outlined ring.
 *
 * Anatomy (500×500 viewBox to match the brand-pack SVG source — preserves
 * proportions exactly so we can drop in the source SVG verbatim for
 * favicon/manifest icons and have parity):
 *   - ring     : outer circle r=200, stroke = currentColor (ink), 28px
 *   - upper    : north triangle, fill = signal blue #2456E6
 *   - lower    : south triangle, fill = currentColor (ink)
 *   - diamond  : center compass-rose diamond, fill = surface-default
 *                (var so it auto-flips in dark mode), 6px blue outline
 *   - dot      : small center disc r=18, fill = currentColor (ink)
 *
 * Color adaptation strategy:
 *   - Ink parts use `currentColor` so the wrapper's `text-text-default`
 *     class drives them. Light mode → near-black. Dark mode → near-white.
 *   - The blue (#2456E6) is hardcoded — it's the brand accent and must
 *     read the same regardless of theme or hover state.
 *   - The diamond's fill uses `var(--color-surface-default)` so it
 *     "cuts out" of the mark visually — appears white on white surface,
 *     dark navy on dark surface. CSS vars work in SVG fill attributes.
 *
 * Brand colors (from /Downloads/Navigatr Roberts Logo/*.svg):
 *   Ink     #0A1733
 *   Signal  #2456E6
 *   Paper   #FFFFFF
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export interface LogoMarkProps extends React.SVGAttributes<SVGSVGElement> {
  /** Pixel dimension. Mark is square. */
  size?: number;
}

export const LogoMark = React.forwardRef<SVGSVGElement, LogoMarkProps>(function LogoMark(
  { size = 28, className, ...rest },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 500 500"
      width={size}
      height={size}
      role="img"
      aria-label="navigatr"
      className={cn("text-text-default shrink-0", className)}
      {...rest}
    >
      <g transform="translate(250, 250)">
        {/* outer ring — ink (currentColor) */}
        <circle cx="0" cy="0" r="200" fill="none" stroke="currentColor" strokeWidth="28" />
        {/* upper triangle — signal blue brand accent (hardcoded) */}
        <polygon points="0,-160 -55,30 55,30" fill="#2456E6" />
        {/* lower triangle — ink (currentColor) */}
        <polygon points="0,160 -55,-30 55,-30" fill="currentColor" />
        {/* center diamond — fills with surface color so the diamond "cuts
            out" against whatever surface the mark sits on. Blue 6px outline
            preserved from the source pack for legibility at small sizes. */}
        <polygon
          points="0,-60 65,0 0,60 -65,0"
          fill="var(--color-surface-default)"
          stroke="#2456E6"
          strokeWidth="6"
        />
        {/* center dot — ink (currentColor), r=18 in the 500-unit space */}
        <circle cx="0" cy="0" r="18" fill="currentColor" />
      </g>
    </svg>
  );
});
LogoMark.displayName = "LogoMark";

export default LogoMark;
