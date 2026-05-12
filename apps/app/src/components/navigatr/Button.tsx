/**
 * navigatr Button — canonical, Figma-fidelity component.
 *
 * Source of truth: Figma file `navigatr v1`, COMPONENT_SET at node 19:300
 * (48 variants: Style × Size × State). Specs pulled directly via the Figma
 * MCP — see commit message for the spec table.
 *
 * ============================================================================
 *  Axes
 * ============================================================================
 *
 *   Style:  primary | secondary | tertiary | destructive | gradient*
 *   Size:   sm | md | lg
 *   State:  rest | hover | pressed | disabled (modeled as CSS pseudo-classes)
 *
 *   * `gradient` is **not in the Figma component set** today — it's a
 *     code-only variant for the marquee Activities-to-Win KPI surface,
 *     using the brand/gradient-from/via/to tokens that DO exist in Figma's
 *     Colors collection. When Figma adds a gradient Style variant, retire
 *     this code-only branch and bind to it.
 *
 * ============================================================================
 *  Dimensions (uniform across all styles)
 * ============================================================================
 *
 *   Size  Height  Padding L/R  Gap   Radius        Label             Icon
 *   sm     32px    12px         8px   6 (radius/sm)  body/md (14/20)   16px
 *   md     40px    16px         8px   10 (radius/md) body/md (14/20)   16px
 *   lg     48px    20px         10px  10 (radius/md) body/lg (16/24)   20px
 *
 *   Vertical padding is 0 across all sizes — content is centered via the
 *   fixed height + auto-layout, not padding. Label weight is Inter
 *   **Regular** (400), NOT Semi-Bold.
 *
 * ============================================================================
 *  Colors per style (state → fill / stroke / text)
 * ============================================================================
 *
 *   primary
 *     rest     brand/primary           / —                / brand/primary-foreground
 *     hover    brand/primary-hover     / —                / brand/primary-foreground
 *     pressed  brand/primary-pressed   / —                / brand/primary-foreground
 *     disabled brand/primary @ op 0.5  / —                / brand/primary-foreground
 *
 *   secondary
 *     rest     surface/elevated        / border/default 1 / text/default
 *     hover    surface/sunken          / border/default 1 / text/default
 *     pressed  surface/sunken          / border/strong  1 / text/default
 *     disabled surface/elevated @ 0.5  / border/default 1 / text/default
 *
 *   tertiary (ghost)
 *     rest     —                       / —                / brand/primary
 *     hover    surface/sunken          / —                / brand/primary
 *     pressed  surface/sunken          / —                / brand/primary-pressed
 *     disabled — @ op 0.5              / —                / brand/primary
 *
 *   destructive
 *     rest     status/danger           / —                / text/inverse
 *     hover    status/danger           / —                / text/inverse   (no Figma delta)
 *     pressed  status/danger           / —                / text/inverse   (no Figma delta)
 *     disabled status/danger @ op 0.5  / —                / text/inverse
 *
 *   gradient (code-only)
 *     rest     brand/gradient-from→via→to (linear, →r)    / text/inverse
 *     hover    same gradient, opacity 0.92                / text/inverse
 *     pressed  same gradient, opacity 0.84                / text/inverse
 *     disabled same gradient, opacity 0.5                 / text/inverse
 *
 *   **Destructive intentionally has no hover/pressed delta in the Figma
 *   source** — flagged for design review; matching Figma exactly here.
 *
 * ============================================================================
 *  States
 * ============================================================================
 *
 *   Disabled = parent opacity 0.5 (whole node), not a fill change. Modeled
 *   via Tailwind's `disabled:opacity-50` so it's automatic when the underlying
 *   `<button>` is disabled.
 *
 *   Focus visible: NOT defined in Figma component states. We add a 2px ring
 *   in brand/primary with 2px offset — standard a11y baseline. Replace with
 *   Figma-defined focus styling when it's added to the component set.
 */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Variant configuration
// ---------------------------------------------------------------------------

const button = cva(
  // BASE — applied to every variant. Layout-only; no color decisions here.
  //
  // Font weight is deliberately `font-medium` (500), NOT inherited from
  // text-body-md (Inter Regular 400) which is what Figma 19:300 specifies
  // via its `body/md` text style. The Regular weight reads as visually
  // thin on saturated button surfaces in real browsers (less so in
  // Figma's render engine), creating a "label-floats-in-empty-button"
  // feel that's actually a weight contrast problem masquerading as a
  // padding problem.
  //
  // Reverse-import action: Figma should grow a `button/md` and
  // `button/lg` text style (Inter Medium 14/20 and Inter Medium 16/24)
  // and the Button component should bind to those instead of `body/*`.
  [
    "inline-flex items-center justify-center whitespace-nowrap font-medium",
    "transition-colors transition-opacity",
    "select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-brand-primary text-brand-primary-foreground",
          "hover:bg-brand-primary-hover active:bg-brand-primary-pressed",
        ],
        secondary: [
          "bg-surface-elevated text-text-default border border-border-default",
          "hover:bg-surface-sunken",
          "active:bg-surface-sunken active:border-border-strong",
        ],
        tertiary: [
          "bg-transparent text-brand-primary",
          "hover:bg-surface-sunken",
          "active:bg-surface-sunken active:text-brand-primary-pressed",
        ],
        destructive: [
          // No hover/pressed delta in Figma — keep fill stable, but still
          // honor active feedback subtly so the press still registers as
          // pressed. If you want to roll back to "exact Figma fidelity"
          // (no feedback), drop the `active:` rule.
          "bg-status-danger text-text-inverse",
          "active:opacity-90",
        ],
        gradient: [
          // Code-only variant — see file-level doc.
          "bg-gradient-to-r from-brand-gradient-from via-brand-gradient-via to-brand-gradient-to",
          "text-text-inverse",
          "hover:opacity-90 active:opacity-80",
        ],
      },
      size: {
        // Icon-to-label gap drifts from Figma's `gap-2` (8 px) to `gap-2.5`
        // (10 px) on md and lg. Figma's 8 px feels too tight in browser
        // render — paired with Medium-weight labels, 10 px reads as
        // intentional breathing room rather than a measurement error.
        // sm stays at 8 px because it's used in dense surfaces (tables,
        // toolbars) where the 16 px icon already dominates.
        sm: ["h-8 px-3 gap-2 rounded-radius-sm text-body-md"],
        md: ["h-10 px-4 gap-2.5 rounded-radius-md text-body-md"],
        lg: ["h-12 px-5 gap-2.5 rounded-radius-md text-body-lg"],
      },
      iconOnly: {
        true: "p-0",
        false: "",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    compoundVariants: [
      // Icon-only sizes are square — collapse padding, set width = height.
      { iconOnly: true, size: "sm", class: "w-8 px-0" },
      { iconOnly: true, size: "md", class: "w-10 px-0" },
      { iconOnly: true, size: "lg", class: "w-12 px-0" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      iconOnly: false,
      fullWidth: false,
    },
  },
);

// Icon dimensions per Figma (NOT per Tailwind's text-size cascade — icons
// scale with the button, not the label).
const ICON_SIZE_CLASS = {
  sm: "h-4 w-4", // 16px
  md: "h-4 w-4", // 16px
  lg: "h-5 w-5", // 20px
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ButtonVariantProps = VariantProps<typeof button>;

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    Omit<ButtonVariantProps, "iconOnly" | "fullWidth"> {
  children?: React.ReactNode;
  /** Lucide icon component (or any SVG component) rendered before the label. */
  leadingIcon?: LucideIcon;
  /** Lucide icon component rendered after the label. */
  trailingIcon?: LucideIcon;
  /** Render as a square icon-only button — `children` becomes the SR-only label. */
  iconOnly?: boolean;
  /** Replace leadingIcon with a spinner and disable interaction. */
  loading?: boolean;
  /** Stretch to fill the parent's width. */
  fullWidth?: boolean;
  /** Forward className for one-off overrides — composed with cva output. */
  className?: string;
  /** Render as a child element (e.g. Next/Link) via Radix Slot. */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size = "md",
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      iconOnly = false,
      loading = false,
      fullWidth = false,
      disabled,
      asChild = false,
      type = "button",
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;
    const iconClass = ICON_SIZE_CLASS[size ?? "md"];

    // When loading, the leading icon slot becomes the spinner. We keep the
    // overall layout stable so the button doesn't reflow.
    const ShownLeading = loading ? Loader2 : LeadingIcon;
    const showTrailing = !loading && TrailingIcon;

    // Icon-only: the children become an aria-label (SR-only). The lone icon
    // is the leading slot (preferred) or trailing if no leading.
    if (iconOnly) {
      const Icon = ShownLeading ?? TrailingIcon;
      if (!Icon) {
        // Misuse — surface clearly in dev rather than rendering a blank box.
        if (import.meta.env.DEV) {
          console.warn(
            "[Button] iconOnly=true requires a leadingIcon or trailingIcon. " +
              "Falling back to children rendering — fix the call site.",
          );
        }
      }
      const labelText =
        typeof children === "string" ? children : props["aria-label"];
      return (
        <Comp
          ref={ref}
          type={asChild ? undefined : type}
          disabled={isDisabled}
          aria-busy={loading || undefined}
          aria-label={labelText}
          className={cn(
            button({ variant, size, iconOnly: true, fullWidth }),
            className,
          )}
          {...props}
        >
          {Icon ? (
            <Icon className={cn(iconClass, loading && "animate-spin")} aria-hidden />
          ) : (
            children
          )}
        </Comp>
      );
    }

    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(button({ variant, size, fullWidth }), className)}
        {...props}
      >
        {ShownLeading && (
          <ShownLeading
            className={cn(iconClass, loading && "animate-spin")}
            aria-hidden
          />
        )}
        {children}
        {showTrailing && TrailingIcon && (
          <TrailingIcon className={iconClass} aria-hidden />
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export default Button;
