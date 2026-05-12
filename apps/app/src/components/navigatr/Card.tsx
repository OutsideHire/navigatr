/**
 * navigatr Card — canonical surface container.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 49:11 (2 variants: State=rest|hover).
 *
 *   320 × HUG · VERTICAL auto-layout · gap 8 · padding 16
 *   fill `surface/default` · stroke `border/subtle` 1 px · radius `radius/md` (10)
 *
 *   rest    shadow  0 1 2  rgba(15,18,23,0.06)   → `shadow-card`
 *   hover   shadow  0 4 12 rgba(15,18,23,0.08)   → `shadow-card-hover`
 *
 *   Internal content frame: VERTICAL, gap 6, no padding.
 *
 * The hover state in the Figma component set drives the lifted shadow when
 * the Card is interactive (`onClick` present). Non-interactive Cards stay
 * at rest elevation.
 *
 * Padding axis is exposed beyond what Figma defines so the Card can host
 * dense KPIs, hero KPIs, drawers, and list groupings without ad-hoc
 * className overrides everywhere.
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const card = cva(
  // Base — layout, transitions, focus ring, disabled. No color/border/radius
  // decisions here; those come from variants.
  [
    "block w-full transition-shadow transition-colors",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ],
  {
    variants: {
      surface: {
        default: "bg-surface-default",
        elevated: "bg-surface-elevated",
        sunken: "bg-surface-sunken",
      },
      padding: {
        none: "p-0",
        sm: "p-3", // 12 — for dense list groupings
        md: "p-4", // 16 — Figma canonical
        lg: "p-5", // 20 — for hero surfaces
        xl: "p-6", // 24 — Figma KPI hero padding
      },
      border: {
        true: "border border-border-subtle",
        false: "border-0",
      },
      shadow: {
        none: "shadow-none",
        sm: "shadow-card",
        md: "shadow-card-hover",
        lg: "shadow-lg",
      },
      radius: {
        sm: "rounded-radius-sm",
        md: "rounded-radius-md",
        lg: "rounded-radius-lg",
      },
      interactive: {
        true: [
          "cursor-pointer text-left",
          "hover:shadow-card-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
        ],
        false: "",
      },
    },
    defaultVariants: {
      surface: "default",
      padding: "md",
      border: true,
      shadow: "none",
      radius: "md",
      interactive: false,
    },
  },
);

type CardVariantProps = VariantProps<typeof card>;
type CardElement = React.ElementType;

export interface CardProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onClick">,
    Omit<CardVariantProps, "interactive"> {
  /** Render as a different element — defaults to `div`. Use `button` (or pass
   *  `onClick`) to make the card a clickable surface. */
  as?: CardElement;
  /** When defined, marks the card interactive and binds the click handler. */
  onClick?: React.MouseEventHandler<HTMLElement>;
  /** Mirror of `disabled` on the underlying element when `as="button"`. */
  disabled?: boolean;
  /** Pass-through for forwarding refs; rare. */
  forwardedRef?: React.Ref<HTMLElement>;
  children?: React.ReactNode;
}

export const Card = React.forwardRef<HTMLElement, CardProps>(function Card(
  {
    as,
    onClick,
    disabled,
    surface,
    padding,
    border,
    shadow,
    radius,
    className,
    children,
    ...rest
  },
  ref,
) {
  const isInteractive = !!onClick;
  // When interactive without an explicit `as`, default to `button` so
  // keyboards & screen readers get the right semantics for free.
  const Comp: CardElement = (as ?? (isInteractive ? "button" : "div")) as CardElement;

  // Default shadow for non-interactive cards stays `none` (matches Figma
  // rest state). Interactive cards bump to `sm` so the resting elevation
  // still suggests "tappable" before hover.
  const resolvedShadow = shadow ?? (isInteractive ? "sm" : "none");

  const extraProps: Record<string, unknown> = {};
  if (Comp === "button") {
    extraProps.type = "button";
    extraProps.disabled = disabled;
  }

  return (
    <Comp
      ref={ref as React.Ref<HTMLElement & HTMLButtonElement>}
      onClick={onClick}
      className={cn(
        card({
          surface,
          padding,
          border,
          shadow: resolvedShadow,
          radius,
          interactive: isInteractive,
        }),
        className,
      )}
      {...extraProps}
      {...rest}
    >
      {children}
    </Comp>
  );
});
Card.displayName = "Card";

export default Card;
