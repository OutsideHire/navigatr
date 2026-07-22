/**
 * navigatr Select — canonical, Figma-fidelity dropdown.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 22:18 (4 variants, one per State).
 * Wraps Radix Select with our token system. Native `<select>` is not used
 * because it can't be styled cross-platform; Radix gives us a fully
 * controllable, accessible portal-rendered listbox.
 *
 * Per-state colors (same shape as Input):
 *   rest      surface/default fill, border/default 1 px,   body/md text
 *   focused   surface/default fill, brand/primary 1.5 px,  body/md text
 *   error     surface/default fill, status/danger 1 px,    body/md text
 *   disabled  surface/sunken  fill, border/subtle 1 px,    body/md text/subtle
 *
 *   Trigger: 40 px tall, px 12, gap 8, radius 10 (radius/md). Chevron-down
 *   trailing icon (Lucide ChevronDown), 16 × 16.
 *
 *   Content panel (no Figma spec — derived from token rhythm):
 *     surface/elevated fill, border/subtle 1 px, radius 10 (radius/md),
 *     shadow-md, item hover bg surface/sunken, selected item subtle dot.
 *
 * Sizing: Figma defines only one size (40 px); we extrapolate sm/lg to
 * match Input's rhythm. Flagged for reverse-import.
 *
 * `multi` prop is typed but not implemented yet — a future session adds
 * chip rendering.
 */

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormField } from "./FormFieldContext";

type SelectSize = "sm" | "md" | "lg";
type SelectState = "rest" | "error" | "disabled";

const sizeClass: Record<SelectSize, string> = {
  sm: "h-8 px-3 gap-2 rounded-radius-sm text-body-md",
  md: "h-10 px-3 gap-2 rounded-radius-md text-body-md",
  lg: "h-12 px-3 gap-2 rounded-radius-md text-body-md",
};

const stateClass: Record<SelectState, string> = {
  rest: [
    "bg-surface-default border-border-default",
    "data-[state=open]:border-brand-primary data-[state=open]:border-1.5",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
  ].join(" "),
  error: [
    "bg-surface-default border-status-danger",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
  ].join(" "),
  disabled: "bg-surface-sunken border-border-subtle text-text-subtle cursor-not-allowed",
};

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  /** Controlled value. Pass with `onValueChange`. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  /** Called on selection change. */
  onValueChange?: (value: string) => void;
  /** Visible options. */
  options: SelectOption[];
  /** Placeholder shown when nothing is selected. */
  placeholder?: string;
  /** Size; defaults to md (Figma canonical). */
  size?: SelectSize;
  /** Explicit state override. Usually inferred from FormField context. */
  state?: SelectState;
  /** Disabled. */
  disabled?: boolean;
  /** Stretch to parent width. */
  fullWidth?: boolean;
  /** Trigger `name` for form integration. */
  name?: string;
  /** Trigger `id` — bound from FormField context when present. */
  id?: string;
  /** Accessible name for the trigger when no visible `<label>` is associated. */
  "aria-label"?: string;
  /** Forward className for trigger overrides. */
  className?: string;
  /** Typed but not implemented yet — chip-based multi-select lands later. */
  multi?: boolean;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder = "Select…",
  size = "md",
  state,
  disabled,
  fullWidth = true,
  name,
  id,
  "aria-label": ariaLabel,
  className,
  multi: _multi, // prop reserved, not implemented this session
}: SelectProps) {
  const ctx = useFormField();
  const effectiveId = id ?? ctx?.inputId;
  const isInvalid = state === "error" || ctx?.isInvalid || false;
  const isDisabled = disabled || ctx?.isDisabled || false;
  const resolvedState: SelectState = isDisabled
    ? "disabled"
    : isInvalid
      ? "error"
      : "rest";

  return (
    <RadixSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={isDisabled}
      name={name}
    >
      <RadixSelect.Trigger
        id={effectiveId}
        aria-label={ariaLabel}
        aria-invalid={isInvalid || undefined}
        aria-describedby={ctx?.helperId}
        aria-required={ctx?.isRequired || undefined}
        className={cn(
          "inline-flex items-center justify-between border transition-colors",
          "text-text-default",
          "data-[placeholder]:text-text-muted",
          fullWidth && "w-full",
          sizeClass[size],
          stateClass[resolvedState],
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="text-text-subtle">
          <ChevronDown className="h-4 w-4" aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden",
            "rounded-radius-md border border-border-subtle bg-surface-elevated shadow-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center gap-2",
                  "rounded-radius-sm px-3 py-2 text-body-md text-text-default outline-none",
                  "data-[highlighted]:bg-surface-sunken data-[highlighted]:text-text-default",
                  "data-[state=checked]:bg-surface-sunken",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                )}
              >
                <span className="flex h-4 w-4 items-center justify-center text-brand-primary">
                  <RadixSelect.ItemIndicator>
                    <Check className="h-4 w-4" aria-hidden />
                  </RadixSelect.ItemIndicator>
                </span>
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

export default Select;
