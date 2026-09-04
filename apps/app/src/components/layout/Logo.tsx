/**
 * navigatr Logo — LogoMark + wordmark composite.
 *
 * LogoMark renders the user-supplied brand SVGs verbatim (light/dark
 * variants toggled via Tailwind dark: modifier — see LogoMark.tsx).
 *
 * Wordmark typography matches the brand pack lockup spec:
 *   font-family: Space Grotesk, 600 weight
 *   letter-spacing: -0.035em (-3.5% per brand-pack README)
 * (The lockup SVG itself uses -10 letter-spacing at 260px font-size,
 * which is -0.038em — we round to -0.035em as a nice round value
 * matching the brand-pack README's stated spec.)
 *
 * White-label: callers can pass a tenant brand name via `wordmark` and a
 * custom URL via `logoSrc` (renders as <img> in place of LogoMark).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/stores/theme";
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
  /** Optional purpose-made logo for dark mode. Used only when the app is in
   *  dark mode; otherwise the main logoSrc is used. */
  logoSrcDark?: string;
  /** Hide the wordmark and show only the mark. */
  iconOnly?: boolean;
}

export const Logo = React.forwardRef<HTMLSpanElement, LogoProps>(function Logo(
  { size = "sm", wordmark = "navigatr", logoSrc, logoSrcDark, iconOnly = false, className, ...rest },
  ref,
) {
  const isDark = useTheme((s) => s.resolvedTheme) === "dark";
  // In dark mode use the purpose-made dark logo when provided. When only the
  // main logo exists, showing it on a dark top bar would risk a dark logo
  // vanishing, so we sit it on a small white backing.
  const effectiveSrc = isDark && logoSrcDark ? logoSrcDark : logoSrc;
  const needsBacking = isDark && !logoSrcDark && Boolean(logoSrc);

  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center", gapClass[size], className)}
      {...rest}
    >
      {effectiveSrc ? (
        <img
          src={effectiveSrc}
          alt={wordmark}
          width={markSize[size]}
          height={markSize[size]}
          className={cn("shrink-0 rounded-radius-sm object-contain", needsBacking && "bg-white p-0.5")}
        />
      ) : (
        <LogoMark size={markSize[size]} />
      )}
      {!iconOnly && (
        <span
          className={cn(wordmarkClass[size], "text-text-default")}
          // Space Grotesk per brand-pack lockup spec. Inline style so we
          // don't have to register a tailwind font-family utility for a
          // single use site. Letter-spacing -3.5% per brand-pack README.
          style={{
            fontFamily:
              "'Space Grotesk', 'Inter', 'Helvetica Neue', Arial, sans-serif",
            fontWeight: 600,
            letterSpacing: "-0.035em",
          }}
        >
          {wordmark}
        </span>
      )}
    </span>
  );
});
Logo.displayName = "Logo";

export default Logo;
