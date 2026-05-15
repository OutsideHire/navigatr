/**
 * navigatr LogoMark — the open-needle waypoint compass.
 *
 * Source: navigatr brand pack v2 (variant C, "Open-needle Waypoint").
 * Outlined ring + outlined needles, lighter optical weight than the
 * original filled-needle mark.
 *
 * Anatomy (40×40 viewBox to match the brand-pack SVG source):
 *   - ring     : outer circle, stroke = currentColor (1.6 at 40-unit scale)
 *   - upper    : north needle, stroke = signal blue #2F5BFF (1.8)
 *   - lower    : south needle, stroke = currentColor (1.8)
 *   - center   : small filled dot, fill = currentColor
 *
 * Ink (`currentColor`) parts adapt to dark mode automatically because the
 * SVG inherits from `text-text-default` on the wrapper. The north needle
 * stays signal blue regardless — that's the brand accent and it pops on
 * both backgrounds.
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
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="img"
      aria-label="navigatr"
      fill="none"
      className={cn("text-text-default shrink-0", className)}
      {...rest}
    >
      {/* outer ring — ink (currentColor) */}
      <circle
        cx="20"
        cy="20"
        r="15.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      {/* upper needle — signal blue (brand accent, hardcoded so it pops
          regardless of light/dark or hover-state recoloring) */}
      <path
        d="M 20 7 L 24 20 L 20 17 L 16 20 Z"
        stroke="#2F5BFF"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* lower needle — ink (currentColor) */}
      <path
        d="M 20 33 L 16 20 L 20 23 L 24 20 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* center dot — small filled disc, ink (currentColor) */}
      <circle cx="20" cy="20" r="1.2" fill="currentColor" />
    </svg>
  );
});
LogoMark.displayName = "LogoMark";

export default LogoMark;
