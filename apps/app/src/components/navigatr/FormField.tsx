/**
 * navigatr FormField — canonical, Figma-fidelity wrapper.
 *
 * Source: Figma `navigatr v1` COMPONENT 123:98.
 *
 *   320 × 86 px (size grows with content)
 *   VERTICAL auto-layout, gap 6 px, no padding
 *
 *   label (TEXT)  : text style `label` — Inter Medium 13/18 — text/default
 *   input (slot)  : 40 px tall, surface/default fill, border/default 1 px stroke
 *   helper (TEXT) : text style `caption` — Inter Regular 12/16 — text/muted
 *
 * The component exposes a React Context so child inputs (Input, Textarea,
 * Select) can auto-detect the field's `id`, `error`, `disabled`, and
 * `required` state without manual prop-passing. Children stay self-sufficient
 * — they read context when present, fall back to their own props otherwise.
 */

import { cn } from "@/lib/utils";
import { FormFieldContext, type FormFieldContextValue } from "./FormFieldContext";

// Context + hook live in `./FormFieldContext` so this file exports only
// components — keeps react-refresh happy and lets the hook be used in
// sibling files like Input.tsx without circular imports.

// ---------------------------------------------------------------------------
// FormField
// ---------------------------------------------------------------------------

export interface FormFieldProps {
  /** Label text. Always rendered (hidden visually when `showLabel=false`). */
  label: string;
  /** id of the input. The label binds to this via htmlFor. */
  htmlFor: string;
  /** Helper text below the input. Suppressed when `error` is set. */
  helper?: string;
  /** Error message — when set, helper styling switches to danger and the
   *  input picks up the error state via context. */
  error?: string;
  /** Marks the field required; renders an asterisk after the label. */
  required?: boolean;
  /** Hide the label visually but keep it for screen readers. */
  showLabel?: boolean;
  /** If the underlying input is disabled, label text fades to text/subtle. */
  disabled?: boolean;
  /** The input/textarea/select element. Must accept an `id` prop matching `htmlFor`. */
  children: React.ReactNode;
  /** Forward className for one-off spacing overrides. */
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  helper,
  error,
  required = false,
  showLabel = true,
  disabled = false,
  children,
  className,
}: FormFieldProps) {
  const helperId = `${htmlFor}-helper`;
  const isInvalid = !!error;

  const ctx: FormFieldContextValue = {
    inputId: htmlFor,
    helperId,
    isInvalid,
    isDisabled: disabled,
    isRequired: required,
  };

  // Figma 123:98 — VERTICAL, gap 6 (= space-y-1.5 in Tailwind defaults but
  // we use gap-1.5 with flex-col for predictable behavior).
  return (
    <FormFieldContext.Provider value={ctx}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        {/* Label — `label` text style: Inter Medium 13/18, text/default */}
        <label
          htmlFor={htmlFor}
          className={cn(
            "text-label",
            disabled ? "text-text-subtle" : "text-text-default",
            // Visually hidden but accessible to screen readers
            !showLabel && "sr-only",
          )}
        >
          {label}
          {required && (
            <span
              aria-hidden
              className="ml-0.5 text-status-danger"
              title="Required"
            >
              *
            </span>
          )}
        </label>

        {children}

        {/* Helper / error text — Figma `caption` style: Inter Regular 12/16 */}
        {(error || helper) && (
          <p
            id={helperId}
            className={cn(
              "text-caption",
              error ? "text-status-danger" : "text-text-muted",
            )}
            role={error ? "alert" : undefined}
          >
            {error ?? helper}
          </p>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}
