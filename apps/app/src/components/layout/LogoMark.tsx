/**
 * navigatr LogoMark — renders the brand-pack source SVG files directly.
 *
 * Files imported verbatim (no hand-translation):
 *   src/assets/brand/icon-light.svg
 *   src/assets/brand/icon-dark.svg
 *
 * Both are copies of the user-supplied source files in
 * /Downloads/Navigatr Roberts Logo/. Vite resolves the imports to
 * fingerprinted URLs at build time, hashed for cache-busting.
 *
 * Theme switch: Tailwind's `dark:` variant hides the light <img> and
 * shows the dark <img> when `.dark` is on <html>. Zero divergence
 * from the source — what the file shows is what renders.
 *
 * Brand pack includes a full-bleed <rect> background fill on both
 * variants (white on light, dark navy on dark). That rect matches
 * the surrounding TopBar surface so it's effectively invisible —
 * the mark integrates into the chrome rather than sitting as a
 * separate badge.
 */

import { cn } from "@/lib/utils";
import iconLight from "@/assets/brand/icon-light.svg";
import iconDark from "@/assets/brand/icon-dark.svg";

export interface LogoMarkProps {
  /** Pixel dimension. Mark is square. */
  size?: number;
  className?: string;
}

export function LogoMark({ size = 28, className }: LogoMarkProps) {
  return (
    <>
      {/* Light variant — visible by default. */}
      <img
        src={iconLight}
        alt="navigatr"
        width={size}
        height={size}
        className={cn("shrink-0 dark:hidden", className)}
        // The mark is decorative when paired with the wordmark; alt is
        // set anyway so it's accessible when iconOnly is true.
      />

      {/* Dark variant — shown when .dark is on <html>. */}
      <img
        src={iconDark}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className={cn("hidden shrink-0 dark:block", className)}
      />
    </>
  );
}

export default LogoMark;
