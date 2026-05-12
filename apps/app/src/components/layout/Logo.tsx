/**
 * navigatr Logo — LogoMark + wordmark composite.
 *
 * Source: Figma `navigatr v1` Logo COMPONENT 104:73 (LogoMark + wordmark
 * text in a horizontal frame, gap 12). Wordmark text style per surface:
 *   Top bar mobile   → heading/sm (Inter Semi Bold 16/24)
 *   Top bar desktop  → heading/md (Inter Semi Bold 20/28)
 *   Auth hero / Logo → heading/lg or larger
 *
 * White-label: callers can pass a tenant brand name via `wordmark` and a
 * custom URL via `logoSrc` (renders as <img> in place of LogoMark).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { LogoMark } from "./LogoMark";

export type LogoSize = "sm" | "md" | "lg";

const markSize: Record<LogoSize, number> = { sm: 28, md: 32, lg: 56 };
const wordmarkClass: Record<LogoSize, string> = {
  sm: "text-heading-sm",
  md: "text-heading-md",
  lg: "text-heading-lg",
};
const gapClass: Record<LogoSize, string> = {
  sm: "gap-2",
  md: "gap-2.5",
  lg: "gap-3",
};

export interface LogoProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "title"> {
  size?: LogoSize;
  /** Wordmark text. Defaults to "navigatr". Override for white-label. */
  wordmark?: string;
  /** Override the compass mark with a tenant logo URL (for white-label). */
  logoSrc?: string;
  /** Hide the wordmark and show only the mark. */
  iconOnly?: boolean;
}

export const Logo = React.forwardRef<HTMLSpanElement, LogoProps>(function Logo(
  { size = "sm", wordmark = "navigatr", logoSrc, iconOnly = false, className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center", gapClass[size], className)}
      {...rest}
    >
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={wordmark}
          width={markSize[size]}
          height={markSize[size]}
          className="shrink-0 rounded-radius-sm object-contain"
        />
      ) : (
        <LogoMark size={markSize[size]} />
      )}
      {!iconOnly && (
        <span className={cn(wordmarkClass[size], "tracking-tight text-text-default")}>
          {wordmark}
        </span>
      )}
    </span>
  );
});
Logo.displayName = "Logo";

export default Logo;
