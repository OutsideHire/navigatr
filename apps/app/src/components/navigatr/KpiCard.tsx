/**
 * navigatr KpiCard — canonical metric display.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 50:98 (12 variants:
 * Size × Accent, where Size ∈ {hero, standard} and Accent ∈ {teal, violet,
 * blue, orange, indigo, pink}).
 *
 *   hero      280 × 140 · padding 24 · gap 12 · value `kpi/lg` (56 px Bold)
 *   standard  220 ×  96 · padding 16 · gap  8 · value `kpi/md` (32 px Bold)
 *
 *   Both:
 *     Card body: surface/default · border/subtle 1 px · radius/md
 *     Shadow:    shadow-card (matches Card rest)
 *     Eyebrow:   text style `eyebrow` (Inter Semi Bold 11/16, uppercase, text/muted)
 *     Value:     tabular-nums applied per DESIGN.md note (KPI numbers always tab)
 *     Trend pill: rounded-radius-full, py-0.5 px-2 gap-1, caption text,
 *                 bg = status-success-bg or status-danger-bg per isPositive,
 *                 text = matching status-success / status-danger
 *
 *   Icon container — NOT in the Figma component yet (the slot is a bare
 *   20 × 20 placeholder). Per the playbook spec, render a colored circle
 *   using alpha-baked accent-{color}-20 background + accent-{color}
 *   foreground icon. Container is 32 × 32 (standard) / 40 × 40 (hero).
 *   Flagged for reverse-import — Figma should add the colored container
 *   pattern to 50:98.
 *
 * Gradient variant
 *   Code-only. Used ONLY for the Activities-to-Win marquee KPI on the
 *   Dashboard (DESIGN.md: one gradient in the entire app).
 *   Background:  bg-gradient-to-br from-brand-gradient-from via-brand-
 *                gradient-via to-brand-gradient-to
 *   Foreground:  text/inverse; eyebrow stays uppercase but uses text-inverse/85
 *   No border, no shadow change.
 *   Trend pill on gradient: white/12% bg, text/inverse text (so the success
 *   green doesn't fight the gradient).
 */

import * as React from "react";
import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type KpiAccent = "teal" | "violet" | "blue" | "orange" | "indigo" | "pink";
export type KpiSize = "standard" | "hero";

interface AccentTokens {
  bg: string; // alpha-baked container background
  fg: string; // icon + accent text
}
const accentTokens: Record<KpiAccent, AccentTokens> = {
  teal:   { bg: "bg-accent-teal-20",   fg: "text-accent-teal"   },
  violet: { bg: "bg-accent-violet-20", fg: "text-accent-violet" },
  blue:   { bg: "bg-accent-blue-20",   fg: "text-accent-blue"   },
  orange: { bg: "bg-accent-orange-20", fg: "text-accent-orange" },
  indigo: { bg: "bg-accent-indigo-20", fg: "text-accent-indigo" },
  pink:   { bg: "bg-accent-pink-20",   fg: "text-accent-pink"   },
};

export interface KpiTrend {
  /** Arrow direction. Determines the icon (▲ or ▼) only. */
  direction: "up" | "down";
  /** e.g. "+18% vs last quarter" — caller decides whether to format. */
  label: string;
  /** Drives the pill color independent of direction (a "down" in
   *  conversions is bad → status-danger; a "down" in churn is good →
   *  status-success). */
  isPositive: boolean;
}

export interface KpiCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  /** Uppercase label — Figma `eyebrow` text style is applied. */
  eyebrow: string;
  /** The big number. Strings or fragments allowed (e.g. `$1.2M`). */
  value: React.ReactNode;
  /** Small text below the value (e.g. "Weighted: $98K"). */
  subtitle?: string;
  /** Optional trend pill with arrow + status color. */
  trend?: KpiTrend;
  /** Lucide icon rendered inside the colored circle. */
  icon?: LucideIcon;
  /** Accent palette for the icon container. Required for non-gradient. */
  accent?: KpiAccent;
  /** `standard` → kpi/md value, 16 padding. `hero` → kpi/lg value, 24 padding. */
  size?: KpiSize;
  /**
   * Special variant — applies the brand gradient background. Used ONLY for
   * the marquee Activities-to-Win KPI per DESIGN.md.
   */
  gradient?: boolean;
  /** Renders the card as a clickable surface (focus ring + cursor pointer). */
  onClick?: () => void;
}

export const KpiCard = React.forwardRef<HTMLDivElement, KpiCardProps>(function KpiCard(
  {
    eyebrow,
    value,
    subtitle,
    trend,
    icon: Icon,
    accent = "teal",
    size = "standard",
    gradient = false,
    onClick,
    className,
    ...rest
  },
  ref,
) {
  const isHero = size === "hero";
  const interactive = !!onClick;

  // Padding + gap + value size
  const cardPadding = isHero ? "p-6" : "p-4"; // 24 / 16
  const cardGap = isHero ? "gap-3" : "gap-2"; // 12 / 8
  const valueClass = isHero ? "text-kpi-lg" : "text-kpi-md";

  // Icon container — 40 × 40 on hero, 32 × 32 on standard. On the gradient
  // variant we invert to a translucent white tile so the icon reads on the
  // saturated background.
  const iconBoxSize = isHero ? "h-10 w-10" : "h-8 w-8";
  const iconClass = isHero ? "h-5 w-5" : "h-4 w-4";
  const accentClasses = gradient
    ? { bg: "bg-text-inverse/15", fg: "text-text-inverse" }
    : accentTokens[accent];

  // Trend pill colors
  const trendPillClass = gradient
    ? "bg-text-inverse/15 text-text-inverse"
    : trend?.isPositive
      ? "bg-status-success-bg text-status-success"
      : "bg-status-danger-bg text-status-danger";

  // Eyebrow + value + subtitle colors flip on gradient
  const eyebrowClass = gradient ? "text-text-inverse/80" : "text-text-muted";
  const valueColor = gradient ? "text-text-inverse" : "text-text-default";
  const subtitleColor = gradient ? "text-text-inverse/80" : "text-text-muted";

  // The card surface itself
  const surfaceClass = gradient
    ? "bg-gradient-to-br from-brand-gradient-from via-brand-gradient-via to-brand-gradient-to text-text-inverse border-0"
    : "bg-surface-default border border-border-subtle shadow-card";

  const TrendIcon = trend?.direction === "down" ? TrendingDown : TrendingUp;

  return (
    <div
      ref={ref}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "flex flex-col rounded-radius-md transition-shadow",
        cardPadding,
        cardGap,
        surfaceClass,
        interactive && [
          "cursor-pointer",
          "hover:shadow-card-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
        ],
        className,
      )}
      {...rest}
    >
      {/* Top row — icon + eyebrow */}
      <div className="flex items-center gap-2">
        {Icon && (
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-radius-full",
              iconBoxSize,
              accentClasses.bg,
              accentClasses.fg,
            )}
            aria-hidden
          >
            <Icon className={iconClass} />
          </span>
        )}
        <span className={cn("text-eyebrow", eyebrowClass)}>{eyebrow}</span>
      </div>

      {/* Value — tabular figures per DESIGN.md */}
      <p className={cn(valueClass, valueColor, "tabular-nums leading-none")}>
        {value}
      </p>

      {/* Subtitle + trend row */}
      {(subtitle || trend) && (
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {subtitle ? (
            <span className={cn("text-caption", subtitleColor)}>{subtitle}</span>
          ) : (
            <span />
          )}
          {trend && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-radius-full px-2 py-0.5 text-caption font-medium tabular-nums",
                trendPillClass,
              )}
            >
              <TrendIcon className="h-3 w-3" aria-hidden />
              {trend.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
KpiCard.displayName = "KpiCard";

export default KpiCard;
