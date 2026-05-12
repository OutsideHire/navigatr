/**
 * navigatr Checkbox / Toggle.
 *
 * ⚠ No Figma source — neither Checkbox nor Toggle exist in the
 * `navigatr v1` component file yet. Built here from token rhythm + DESIGN.md
 * guidance. **Flagged for reverse-import:** add these to Figma so future
 * sessions can pull canonical specs.
 *
 * Variants:
 *   variant="checkbox" (default) — 20 × 20 box, radius/sm, brand/primary
 *                                  fill when checked, white check icon.
 *   variant="toggle"             — pill switch (40 × 24), sliding knob,
 *                                  brand/primary track when on, surface/
 *                                  sunken when off.
 *
 * Both variants:
 *   - Accept `label` and `helper` for inline composition (label sits to the
 *     right of the control with gap 2)
 *   - Match Button focus-ring styling (2 px brand/primary ring, 2 px offset)
 *   - Fade to opacity 0.5 when disabled
 */

import * as React from "react";
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as RadixSwitch from "@radix-ui/react-switch";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared label / helper renderer
// ---------------------------------------------------------------------------

function ControlLabel({
  htmlFor,
  label,
  helper,
  disabled,
}: {
  htmlFor: string;
  label?: string;
  helper?: string;
  disabled?: boolean;
}) {
  if (!label && !helper) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {label && (
        <label
          htmlFor={htmlFor}
          className={cn(
            "cursor-pointer text-body-md",
            disabled ? "cursor-not-allowed text-text-subtle" : "text-text-default",
          )}
        >
          {label}
        </label>
      )}
      {helper && (
        <span className={cn("text-caption", disabled ? "text-text-subtle/70" : "text-text-muted")}>
          {helper}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combined export — Checkbox with `variant` switch.
// ---------------------------------------------------------------------------

interface BaseProps {
  /** Controlled checked state. */
  checked?: boolean;
  /** Uncontrolled initial state. */
  defaultChecked?: boolean;
  /** Called when the user toggles. */
  onCheckedChange?: (checked: boolean) => void;
  /** Element id — also wires the label. */
  id?: string;
  /** Inline label, rendered to the right of the control. */
  label?: string;
  /** Helper text, rendered below the label. */
  helper?: string;
  /** Standard disabled. */
  disabled?: boolean;
  /** Forward className for outer wrapper. */
  className?: string;
  /** Form input name. */
  name?: string;
  /** Required form attribute. */
  required?: boolean;
}

export interface CheckboxProps extends BaseProps {
  variant?: "checkbox" | "toggle";
}

function useFieldId(provided?: string): string {
  const auto = React.useId();
  return provided ?? auto;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    {
      variant = "checkbox",
      checked,
      defaultChecked,
      onCheckedChange,
      id,
      label,
      helper,
      disabled,
      className,
      name,
      required,
    },
    ref,
  ) => {
    const fieldId = useFieldId(id);

    if (variant === "toggle") {
      return (
        <div className={cn("flex items-start gap-3", className)}>
          <RadixSwitch.Root
            ref={ref as React.Ref<HTMLButtonElement>}
            id={fieldId}
            name={name}
            checked={checked}
            defaultChecked={defaultChecked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            required={required}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-radius-full",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "data-[state=unchecked]:bg-surface-sunken data-[state=unchecked]:border data-[state=unchecked]:border-border-default",
              "data-[state=checked]:bg-brand-primary",
            )}
          >
            <RadixSwitch.Thumb
              className={cn(
                "block h-5 w-5 rounded-radius-full bg-surface-default shadow-sm transition-transform",
                "data-[state=unchecked]:translate-x-0.5",
                "data-[state=checked]:translate-x-[22px]",
              )}
            />
          </RadixSwitch.Root>
          <ControlLabel htmlFor={fieldId} label={label} helper={helper} disabled={disabled} />
        </div>
      );
    }

    // Checkbox variant
    return (
      <div className={cn("flex items-start gap-3", className)}>
        <RadixCheckbox.Root
          ref={ref as React.Ref<HTMLButtonElement>}
          id={fieldId}
          name={name}
          checked={checked}
          defaultChecked={defaultChecked}
          onCheckedChange={(c) => onCheckedChange?.(c === true)}
          disabled={disabled}
          required={required}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-radius-sm border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "data-[state=unchecked]:border-border-default data-[state=unchecked]:bg-surface-default",
            "data-[state=checked]:border-brand-primary data-[state=checked]:bg-brand-primary",
          )}
        >
          <RadixCheckbox.Indicator>
            <Check className="h-3.5 w-3.5 text-brand-primary-foreground" aria-hidden strokeWidth={3} />
          </RadixCheckbox.Indicator>
        </RadixCheckbox.Root>
        <ControlLabel htmlFor={fieldId} label={label} helper={helper} disabled={disabled} />
      </div>
    );
  },
);
Checkbox.displayName = "Checkbox";

export default Checkbox;
