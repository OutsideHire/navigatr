/**
 * navigatr Avatar — user/contact photo with initials fallback.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 24:47 (10 variants: Size ×
 * Content where Size ∈ {24,32,40,56,80} and Content ∈ {with-photo, with-initials}).
 *
 *   Size  Diameter  Text style (initials)
 *   xs    24 px     caption (12/16)
 *   sm    32 px     label   (13/18)
 *   md    40 px     body/strong (14/20 600)
 *   lg    56 px     heading/sm  (16/24)
 *   xl    80 px     heading/md  (20/28)
 *
 *   Shape: radius/full (circle) — Figma. `square` is a code-only addition
 *   per playbook (no Figma source).
 *   Initials fill: Figma's sample uses `accent/violet` for one demo. The
 *   canonical playbook pattern rotates through 4 accent palettes based on
 *   a deterministic hash of `alt` so the same person always gets the same
 *   color — implemented here.
 *
 * Status indicator (online/offline/away) is NOT in the Figma component set
 * yet — code-only extension per playbook. Sized at 25% of the avatar
 * diameter, white border 2 px to separate from the avatar, positioned
 * bottom-right with slight overlap. Flagged for reverse-import.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarShape = "circle" | "square";
export type AvatarStatus = "online" | "offline" | "away" | "none";

const sizeDim: Record<AvatarSize, number> = {
  xs: 24, sm: 32, md: 40, lg: 56, xl: 80,
};

const sizeText: Record<AvatarSize, string> = {
  xs: "text-caption",
  sm: "text-label",
  md: "text-body-strong",
  lg: "text-heading-sm",
  xl: "text-heading-md",
};

const ACCENT_PALETTE = [
  { bg: "bg-accent-teal-20",   fg: "text-accent-teal"   },
  { bg: "bg-accent-violet-20", fg: "text-accent-violet" },
  { bg: "bg-accent-blue-20",   fg: "text-accent-blue"   },
  { bg: "bg-accent-orange-20", fg: "text-accent-orange" },
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function deriveInitials(alt: string): string {
  const cleaned = alt.trim();
  if (!cleaned) return "?";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
  return (words[0]!.charAt(0) + words[words.length - 1]!.charAt(0)).toUpperCase();
}

const statusColor: Record<Exclude<AvatarStatus, "none">, string> = {
  online: "bg-status-success",
  offline: "bg-text-subtle",
  away: "bg-status-warning",
};

export interface AvatarProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "title"> {
  src?: string;
  alt: string;
  fallback?: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  statusIndicator?: AvatarStatus;
}

export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { src, alt, fallback, size = "md", shape = "circle", statusIndicator = "none", className, ...rest },
  ref,
) {
  const [imageOk, setImageOk] = React.useState(true);
  React.useEffect(() => { setImageOk(true); }, [src]);

  const initials = fallback ?? deriveInitials(alt);
  const palette = ACCENT_PALETTE[hashString(alt) % ACCENT_PALETTE.length]!;
  const dim = sizeDim[size];
  const radius = shape === "circle" ? "rounded-radius-full" : "rounded-radius-md";

  // Status indicator — 25% of diameter, min 8 px, with a 2 px surface-canvas
  // border so it visually detaches from the avatar.
  const indDim = Math.max(8, Math.round(dim * 0.25));

  return (
    <span
      ref={ref}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden",
        radius,
        className,
      )}
      style={{ width: dim, height: dim }}
      {...rest}
    >
      {src && imageOk ? (
        <img
          src={src}
          alt={alt}
          className={cn("h-full w-full object-cover", radius)}
          onError={() => setImageOk(false)}
        />
      ) : (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center font-semibold",
            palette.bg,
            palette.fg,
            sizeText[size],
            radius,
          )}
          aria-hidden
        >
          {initials}
        </span>
      )}

      {statusIndicator !== "none" && (
        <span
          aria-hidden
          className={cn(
            "absolute bottom-0 right-0 rounded-radius-full border-2 border-surface-canvas",
            statusColor[statusIndicator],
          )}
          style={{ width: indDim, height: indDim }}
        />
      )}
    </span>
  );
});
Avatar.displayName = "Avatar";

export default Avatar;
