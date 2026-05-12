/**
 * navigatr ListRow — canonical flexible row.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 51:110 (16 variants:
 * leading × trailing — each axis: icon / avatar / status-indicator / badge /
 * chevron / action / none).
 *
 *   360 × 56 (min-height) · HORIZONTAL auto-layout · gap 12
 *   Padding 12 / 16 / 12 / 16 (top/right/bottom/left)
 *   Fill surface/default · radius `radius/sm` (6)
 *   Main column: VERTICAL, gap 2 — title (`body-strong`) + subtitle (`caption`)
 *
 *   Leading slots in Figma:
 *     icon              16 × 16
 *     avatar            32 × 32 round
 *     status-indicator  12 × 12 dot (status/* fill)
 *     none              no leading slot
 *
 *   Trailing slots:
 *     badge    42 × 22 pill, padding 3/8/3/8, status/info-bg fill
 *     chevron  20 × 20 icon
 *     action   32 × 32 surface/sunken icon button
 *     none
 *
 * Used across activity feeds, partner lists, settings rows, path stops,
 * contact info sections, integration tiles. The component is intentionally
 * dumb — callers pass whatever node they want in `leading`/`trailing` so
 * the slot fits feature shapes (avatars, status dots, custom chips, etc.).
 *
 * Touch-target compliance: the 56 px min height beats the 44 px iOS HIG
 * minimum.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ListRowProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onClick" | "title"> {
  /** Optional leading slot — icon, avatar, dot, checkbox, numbered circle. */
  leading?: React.ReactNode;
  /** Primary line — `body-strong` typography, truncates with ellipsis. */
  title: React.ReactNode;
  /** Secondary line below the title — `caption` typography, truncates. */
  subtitle?: React.ReactNode;
  /** Optional trailing slot — badge, chevron, action button, timestamp. */
  trailing?: React.ReactNode;
  /** Renders the row as a clickable surface (hover bg + focus ring). */
  onClick?: React.MouseEventHandler<HTMLElement>;
  /** Disabled state: opacity 0.5 + no interaction. */
  disabled?: boolean;
  /** Renders a 1 px bottom border so multiple ListRows stack with dividers
   *  without needing a wrapping Card. */
  divider?: boolean;
  /** Render as a different element — defaults to `div`, or `button` when interactive. */
  as?: keyof React.JSX.IntrinsicElements;
}

export const ListRow = React.forwardRef<HTMLElement, ListRowProps>(function ListRow(
  {
    leading,
    title,
    subtitle,
    trailing,
    onClick,
    disabled = false,
    divider = false,
    as,
    className,
    ...rest
  },
  ref,
) {
  const interactive = !!onClick && !disabled;
  const Comp = (as ?? (interactive ? "button" : "div")) as React.ElementType;

  const extra: Record<string, unknown> = {};
  if (Comp === "button") {
    extra.type = "button";
    extra.disabled = disabled;
  }

  return (
    <Comp
      ref={ref as React.Ref<HTMLElement>}
      onClick={interactive ? onClick : undefined}
      className={cn(
        // Figma exact: min-h 56, gap 12, padding 12/16
        "flex w-full items-center gap-3 px-4 py-3 text-left",
        "min-h-[56px]",
        "bg-surface-default",
        "rounded-radius-sm",
        "transition-colors",
        divider && "border-b border-border-subtle rounded-none",
        interactive && [
          "cursor-pointer",
          "hover:bg-surface-sunken",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
        ],
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      aria-disabled={disabled || undefined}
      {...extra}
      {...rest}
    >
      {leading && (
        <span className="flex shrink-0 items-center justify-center">{leading}</span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-strong text-text-default">{title}</span>
        {subtitle && (
          <span className="truncate text-caption text-text-muted">{subtitle}</span>
        )}
      </div>
      {trailing && <span className="flex shrink-0 items-center">{trailing}</span>}
    </Comp>
  );
});
ListRow.displayName = "ListRow";

export default ListRow;
