/**
 * navigatr LogoMark — the compass-needle glyph.
 *
 * Source: Figma `navigatr v1` (logo-mark inside Top bar mobile 114:2,
 * Top bar desktop 114:7, Logo 123:93). Same primitive at three sizes.
 *
 * Anatomy:
 *   - ring    : outer circle, stroke = text/default 1.5 px (scales)
 *   - upper   : top half-needle, fill = brand/primary
 *   - lower   : bottom half-needle, fill = text/default
 *   - center  : small ring at center, stroke = text/default 1 px
 *
 * All "text/default" parts use `currentColor` so the mark adopts the
 * surrounding text color automatically (light/dark mode just works).
 * The upper needle uses `fill-brand-primary` so it pops regardless.
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
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label="navigatr"
      className={cn("text-text-default shrink-0", className)}
      {...rest}
    >
      {/* outer ring — currentColor (text/default) */}
      <circle
        cx="16"
        cy="16"
        r="14.85"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      {/* upper needle — brand primary */}
      <path
        d="M16 4.5 L18.6 16 L13.4 16 Z"
        className="fill-brand-primary"
      />
      {/* lower needle — text/default */}
      <path
        d="M16 27.5 L13.4 16 L18.6 16 Z"
        fill="currentColor"
      />
      {/* center dot — small ring, text/default */}
      <circle
        cx="16"
        cy="16"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
});
LogoMark.displayName = "LogoMark";

export default LogoMark;
