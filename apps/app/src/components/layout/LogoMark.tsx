/**
 * navigatr LogoMark — pixel-perfect match to the Roberts brand pack.
 *
 * Source files (truth):
 *   /Downloads/Navigatr Roberts Logo/navigatr-icon-light.svg
 *   /Downloads/Navigatr Roberts Logo/navigatr-icon-dark.svg
 *
 * Strategy: embed BOTH source SVGs inline verbatim and toggle via Tailwind's
 * `dark:` variant. Earlier attempts used `currentColor` + CSS variables to
 * adapt a single SVG to either theme — clever, but it didn't render
 * pixel-identical to the source files because the diamond's "negative space"
 * effect requires a specific fill that disagrees with currentColor logic.
 *
 * The source SVGs include a full-bleed `<rect>` background fill. We strip
 * that for the in-app component — the mark needs to integrate into the
 * surrounding TopBar / nav surface, not sit as a contrasting badge. The
 * background rect IS preserved in the favicon.svg / PWA icon files where
 * a contrasting tile is appropriate.
 *
 * Brand colors (from the source SVGs, used as literal hex):
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
  const shared = {
    viewBox: "0 0 500 500",
    width: size,
    height: size,
    role: "img" as const,
    "aria-label": "navigatr",
    ref,
    ...rest,
  };

  return (
    <>
      {/* Light variant — visible on light surfaces (default theme). */}
      <svg {...shared} className={cn("shrink-0 dark:hidden", className)}>
        <g transform="translate(250, 250)">
          <circle cx="0" cy="0" r="200" fill="none" stroke="#0A1733" strokeWidth="28" />
          <polygon points="0,-160 -55,30 55,30" fill="#2456E6" />
          <polygon points="0,160 -55,-30 55,-30" fill="#0A1733" />
          <polygon
            points="0,-60 65,0 0,60 -65,0"
            fill="#FFFFFF"
            stroke="#2456E6"
            strokeWidth="6"
          />
          <circle cx="0" cy="0" r="18" fill="#0A1733" />
        </g>
      </svg>

      {/* Dark variant — visible on dark surfaces (.dark class on <html>). */}
      <svg {...shared} className={cn("hidden shrink-0 dark:block", className)}>
        <g transform="translate(250, 250)">
          <circle cx="0" cy="0" r="200" fill="none" stroke="#FFFFFF" strokeWidth="28" />
          <polygon points="0,-160 -55,30 55,30" fill="#2456E6" />
          <polygon points="0,160 -55,-30 55,-30" fill="#FFFFFF" />
          <polygon
            points="0,-60 65,0 0,60 -65,0"
            fill="#0A1733"
            stroke="#2456E6"
            strokeWidth="6"
          />
          <circle cx="0" cy="0" r="18" fill="#FFFFFF" />
        </g>
      </svg>
    </>
  );
});
LogoMark.displayName = "LogoMark";

export default LogoMark;
