/**
 * navigatr Input — canonical, Figma-fidelity text input.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 21:43 (8 variants:
 * State × MultiLine). Only State axis used here — MultiLine has its own
 * component (Textarea).
 *
 * Per-state colors (md size — canonical Figma):
 *
 *   State     Fill              Stroke              Stroke W   Text fill
 *   rest      surface/default   border/default      1 px       text/default
 *   focused   surface/default   brand/primary       1.5 px     text/default
 *   error     surface/default   status/danger       1 px       text/default
 *   disabled  surface/sunken    border/subtle       1 px       text/subtle
 *
 *   Placeholder always uses text/muted.
 *   Padding: 0 / 12 / 0 / 12 (vertical 0 via fixed 40 px height + Inter line-height)
 *   Gap (icon-to-text): 8 px
 *   Radius: 10 px (radius/md)
 *   Text style: body/md — Inter Regular 14/20
 *
 * Sizing:
 *   Figma defines ONLY md (40 px). sm and lg are extrapolated to match the
 *   Button's size rhythm:
 *
 *     sm  h 32  px 12  gap 8   radius/sm  body/md
 *     md  h 40  px 12  gap 8   radius/md  body/md   ← Figma canonical
 *     lg  h 48  px 12  gap 8   radius/md  body/md
 *
 *   The Figma Input component set should grow to include sm/lg variants;
 *   flagged for reverse-import.
 *
 * State detection:
 *   When rendered inside a FormField, the Input picks up `isInvalid` and
 *   `isDisabled` from context automatically. The `state` prop is an explicit
 *   override for cases where the Input is used standalone (rare).
 */

import * as React from "react";
import { X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormField } from "./FormFieldContext";

type InputSize = "sm" | "md" | "lg";
type InputState = "rest" | "error" | "disabled";

// Wrapper-level state classes — these drive border / fill / focus-within.
// We style the *wrapper*, not the bare `<input>`, because leading/trailing
// icons and prefix/suffix live alongside the input.
const wrapperState: Record<InputState, string> = {
  rest: [
    "bg-surface-default border-border-default",
    "focus-within:border-brand-primary focus-within:border-1.5",
    "focus-within:ring-2 focus-within:ring-brand-primary focus-within:ring-offset-2 focus-within:ring-offset-surface-canvas",
  ].join(" "),
  error: [
    "bg-surface-default border-status-danger",
    "focus-within:ring-2 focus-within:ring-status-danger focus-within:ring-offset-2 focus-within:ring-offset-surface-canvas",
  ].join(" "),
  disabled: "bg-surface-sunken border-border-subtle cursor-not-allowed",
};

// Per-size dimensions — wrapper height + horizontal padding.
const wrapperSize: Record<InputSize, string> = {
  sm: "h-8 rounded-radius-sm",
  md: "h-10 rounded-radius-md",
  lg: "h-12 rounded-radius-md",
};

// Per-size horizontal pad on the wrapper. We hold pad on the wrapper so
// the focus ring tracks the full visual element, not just the bare input.
// Per-element horizontal pad is reset when icons/adornments are present.
const sizeHPad = "px-3"; // 12 px — Figma exact

// Icon dimensions per size.
const iconSize: Record<InputSize, string> = {
  sm: "h-4 w-4",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Visual size. Figma canonical is `md`; `sm`/`lg` are extrapolated. */
  size?: InputSize;
  /** Lucide icon rendered before the input text. */
  leadingIcon?: LucideIcon;
  /** Lucide icon rendered after the input text. Hidden when `onClear` shows the X. */
  trailingIcon?: LucideIcon;
  /** Static text adornment before the input (e.g. "$"). */
  prefix?: string;
  /** Static text adornment after the input (e.g. "%"). */
  suffix?: string;
  /** When defined, shows an X button to clear the value (only when value is non-empty). */
  onClear?: () => void;
  /** Explicit state override. Most callers should rely on FormField context. */
  state?: InputState;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      size = "md",
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      prefix,
      suffix,
      onClear,
      state,
      className,
      id,
      disabled,
      readOnly,
      value,
      ...props
    },
    ref,
  ) => {
    const ctx = useFormField();
    const effectiveId = id ?? ctx?.inputId;
    const isInvalid = (state === "error") || ctx?.isInvalid || false;
    const isDisabled = disabled || ctx?.isDisabled || false;
    const resolvedState: InputState = isDisabled
      ? "disabled"
      : isInvalid
        ? "error"
        : "rest";

    // The wrapper hosts the focus styling. Border is 1px in rest/error/disabled
    // and 1.5px on focus-within (rest only) — Figma exact.
    const hasContent = value !== undefined && value !== "" && value !== null;
    const showClear = !!onClear && hasContent && !isDisabled && !readOnly;
    const iSize = iconSize[size];

    return (
      <div
        className={cn(
          "relative flex w-full items-center gap-2",
          "border transition-colors",
          wrapperSize[size],
          sizeHPad,
          wrapperState[resolvedState],
          className,
        )}
        aria-disabled={isDisabled || undefined}
      >
        {LeadingIcon && (
          <LeadingIcon
            className={cn(
              iSize,
              "shrink-0 text-text-subtle",
              isDisabled && "text-text-subtle/60",
            )}
            aria-hidden
          />
        )}
        {prefix && (
          <span className={cn("shrink-0 text-body-md text-text-muted", isDisabled && "text-text-subtle")}>
            {prefix}
          </span>
        )}

        <input
          ref={ref}
          id={effectiveId}
          disabled={isDisabled}
          readOnly={readOnly}
          value={value}
          aria-invalid={isInvalid || undefined}
          aria-describedby={ctx?.helperId}
          aria-required={ctx?.isRequired || undefined}
          className={cn(
            // Bare input — no border, no bg. Wrapper carries the look.
            "min-w-0 flex-1 bg-transparent text-body-md",
            "text-text-default placeholder:text-text-muted",
            "focus:outline-none",
            "disabled:cursor-not-allowed disabled:text-text-subtle disabled:placeholder:text-text-subtle/70",
            // Hide native number-input spin buttons (Chrome/Safari/Firefox)
            "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
          )}
          {...props}
        />

        {suffix && (
          <span className={cn("shrink-0 text-body-md text-text-muted", isDisabled && "text-text-subtle")}>
            {suffix}
          </span>
        )}

        {showClear ? (
          <button
            type="button"
            onClick={onClear}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-radius-full",
              "text-text-subtle hover:bg-surface-sunken hover:text-text-default",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
              size === "sm" ? "h-5 w-5" : size === "md" ? "h-6 w-6" : "h-7 w-7",
            )}
            aria-label="Clear input"
            tabIndex={-1}
          >
            <X className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} aria-hidden />
          </button>
        ) : (
          TrailingIcon && (
            <TrailingIcon
              className={cn(
                iSize,
                "shrink-0 text-text-subtle",
                isDisabled && "text-text-subtle/60",
              )}
              aria-hidden
            />
          )
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

export default Input;
