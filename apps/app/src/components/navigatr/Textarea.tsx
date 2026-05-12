/**
 * navigatr Textarea — multi-line variant of Input.
 *
 * Source: Figma `navigatr v1` 21:43 (Input set), `MultiLine=true` variants.
 *
 *   96 × N px (rest)  — same per-state borders/fills as Input
 *   Padding 10 / 12 / 10 / 12 (top/right/bottom/left)
 *   Gap 8, radius 10 (radius/md)
 *   Text style body/md
 *
 * The MultiLine variant carries vertical padding (10 px each side); single-
 * line Input centers content via fixed height. That's the only meaningful
 * delta from Input.
 *
 * Extras hand-authored (no Figma source yet — flag for design):
 *   - Character count when `maxLength` is set (bottom-right, caption)
 *   - Optional mic button (bottom-right) via `onMicClick` — feeds the
 *     speech-to-text affordance the NotesFieldWithMic component will use
 *     in Session 9
 */

import * as React from "react";
import { Mic, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormField } from "./FormFieldContext";

type TextareaState = "rest" | "error" | "disabled";

const wrapperState: Record<TextareaState, string> = {
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

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Optional Lucide icon at the bottom-right, e.g. for speech-to-text. */
  onMicClick?: () => void;
  /** Override the icon used for the mic button (defaults to Lucide `Mic`). */
  micIcon?: LucideIcon;
  /** Explicit state override; usually picked up from FormField context. */
  state?: TextareaState;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      id,
      disabled,
      readOnly,
      value,
      defaultValue,
      maxLength,
      rows = 4,
      onMicClick,
      micIcon: MicIcon = Mic,
      state,
      className,
      ...props
    },
    ref,
  ) => {
    const ctx = useFormField();
    const effectiveId = id ?? ctx?.inputId;
    const isInvalid = state === "error" || ctx?.isInvalid || false;
    const isDisabled = disabled || ctx?.isDisabled || false;
    const resolvedState: TextareaState = isDisabled
      ? "disabled"
      : isInvalid
        ? "error"
        : "rest";

    // Show character count when maxLength is set. We track value via the
    // controlled prop OR fall back to a local state mirror so uncontrolled
    // usage works too.
    const [localValue, setLocalValue] = React.useState<string>(
      (defaultValue as string | undefined) ?? "",
    );
    const isControlled = value !== undefined;
    const currentLength = isControlled
      ? String(value).length
      : localValue.length;

    return (
      <div
        className={cn(
          "relative flex w-full flex-col",
          "rounded-radius-md border transition-colors",
          wrapperState[resolvedState],
          className,
        )}
        aria-disabled={isDisabled || undefined}
      >
        <textarea
          ref={ref}
          id={effectiveId}
          disabled={isDisabled}
          readOnly={readOnly}
          rows={rows}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          onChange={(e) => {
            if (!isControlled) setLocalValue(e.target.value);
            props.onChange?.(e);
          }}
          aria-invalid={isInvalid || undefined}
          aria-describedby={ctx?.helperId}
          aria-required={ctx?.isRequired || undefined}
          className={cn(
            // Bare textarea — wrapper carries border/bg.
            "min-h-0 flex-1 resize-y bg-transparent text-body-md leading-5",
            "text-text-default placeholder:text-text-muted",
            "focus:outline-none",
            "px-3 py-2.5", // Figma: 12 horizontal, 10 vertical
            "disabled:cursor-not-allowed disabled:text-text-subtle disabled:placeholder:text-text-subtle/70",
          )}
          {...props}
        />

        {(maxLength || onMicClick) && (
          <div
            className={cn(
              "flex items-center justify-between gap-2 px-3 pb-2 pt-1",
              "border-t border-border-subtle",
            )}
          >
            {onMicClick ? (
              <button
                type="button"
                onClick={onMicClick}
                disabled={isDisabled}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-radius-full",
                  "text-text-subtle hover:bg-surface-sunken hover:text-text-default",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                  "disabled:opacity-50",
                )}
                aria-label="Dictate"
              >
                <MicIcon className="h-4 w-4" aria-hidden />
              </button>
            ) : (
              <span />
            )}

            {maxLength && (
              <span
                className={cn(
                  "text-caption tabular-nums",
                  currentLength > maxLength * 0.9
                    ? "text-status-warning"
                    : "text-text-subtle",
                  currentLength >= maxLength && "text-status-danger",
                )}
                aria-live="polite"
              >
                {currentLength} / {maxLength}
              </span>
            )}
          </div>
        )}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";

export default Textarea;
