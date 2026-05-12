/**
 * navigatr Chip — filter pill.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 22:31 (3 variants: State =
 * rest | active | disabled).
 *
 *   md (Figma)   28 × HUG · padding 0 / 12 · gap 6 · radius/full · caption
 *   sm (extrap)  24 × HUG · padding 0 / 10 · gap 4 · radius/full · caption
 *
 *   rest      surface/elevated bg · border/subtle 1 px · text/muted
 *   active    brand/primary bg · no border · brand/primary-foreground
 *   disabled  same as rest, but text/subtle, opacity 0.5
 *
 * Count badge: small inset pill rendered after children. On rest chip it's
 * a subtle bg-surface-sunken pill; on active chip it inverts to white/15%.
 * Not in Figma — code-only extension per playbook.
 */

import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  active?: boolean;
  count?: number;
  leadingIcon?: LucideIcon;
  size?: "sm" | "md";
  children: React.ReactNode;
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { active = false, count, leadingIcon: LeadingIcon, size = "md", className, disabled, type = "button", children, ...rest },
  ref,
) {
  const sizeCls = size === "sm"
    ? "h-6 px-2.5 gap-1 text-caption"
    : "h-7 px-3 gap-1.5 text-caption";

  const stateCls = active
    ? "bg-brand-primary text-brand-primary-foreground border-transparent"
    : "bg-surface-elevated border border-border-subtle text-text-muted hover:bg-surface-sunken hover:text-text-default";

  const countCls = active
    ? "bg-text-inverse/20 text-text-inverse"
    : "bg-surface-sunken text-text-default";

  const iconCls = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center rounded-radius-full font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sizeCls,
        stateCls,
        className,
      )}
      {...rest}
    >
      {LeadingIcon && <LeadingIcon className={iconCls} aria-hidden />}
      <span>{children}</span>
      {typeof count === "number" && (
        <span className={cn("ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-radius-full px-1 text-[10px] font-semibold tabular-nums", countCls)}>
          {count}
        </span>
      )}
    </button>
  );
});
Chip.displayName = "Chip";

export default Chip;
