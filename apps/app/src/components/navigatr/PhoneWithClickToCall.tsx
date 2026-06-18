/**
 * navigatr PhoneWithClickToCall — formatted phone number + tap-to-call button.
 *
 * Source: Figma `navigatr v1` COMPONENT_SET 51:131 (4 variants: State ×
 * Format, where State ∈ {valid, invalid} and Format ∈ {single-number, multi-number}).
 *
 *   md (Figma canonical)   button 44 × 44 · gap 12 · label text/default (valid)
 *                          or text/subtle (invalid) · radius/sm button (6)
 *   sm (extrapolated)      button 32 × 32 · gap 8
 *   lg (extrapolated)      button 52 × 52 · gap 12
 *
 *   Button is a small icon-only Button (canonical from Session 6, variant=
 *   secondary). The 44 px md size matches Apple HIG's 44 pt touch target
 *   minimum — this is the foundational "click to call" affordance per
 *   PRD FR-CALL-06.
 *
 * Parsing: libphonenumber-js. The component accepts any string format and
 * outputs `displayFormat`-formatted display + a tel: URI for the call. If
 * parsing fails the component renders in `invalid` state (greyed,
 * disabled button, helper "Invalid number").
 *
 * Multi-number variant: shows a chevron-down to expand alternateNumbers
 * in a small popover. We render the popover inline (no Radix Popover dep
 * needed for this) — clicking the chevron toggles a small list.
 */

import * as React from "react";
import { Phone, ChevronDown, ChevronUp } from "lucide-react";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export type PhoneSize = "sm" | "md" | "lg";

export interface AlternateNumber {
  label: string;
  phoneNumber: string;
}

export interface PhoneWithClickToCallProps {
  phoneNumber: string;
  displayFormat?: "us" | "international";
  multiNumber?: boolean;
  alternateNumbers?: AlternateNumber[];
  onCallClick?: (number: string) => void;
  disabled?: boolean;
  size?: PhoneSize;
  className?: string;
}

export const PhoneWithClickToCall = React.forwardRef<HTMLDivElement, PhoneWithClickToCallProps>(
  function PhoneWithClickToCall(
    {
      phoneNumber,
      displayFormat = "us",
      multiNumber = false,
      alternateNumbers = [],
      onCallClick,
      disabled = false,
      size = "md",
      className,
    },
    ref,
  ) {
    const [expanded, setExpanded] = React.useState(false);
    const primary = formatPhone(phoneNumber, displayFormat);
    const isInvalid = !primary.valid;
    const isDisabled = disabled || isInvalid;

    const handleCall = (e164OrRaw: string) => {
      if (onCallClick) {
        onCallClick(e164OrRaw);
      } else if (typeof window !== "undefined") {
        window.location.assign(`tel:${e164OrRaw}`);
      }
    };

    // Button size mapping — md is Figma canonical at 44×44; sm/lg
    // extrapolated. Canonical Button's `sm` is 32 px, `md` 40 px, `lg` 48 px.
    // We want 32/44/52 so use Button + explicit className for md/lg overrides.
    const btnSize = size === "sm" ? "sm" : "md";
    const btnSizeOverride =
      size === "md" ? "h-11 w-11" :
      size === "lg" ? "h-[52px] w-[52px]" :
      ""; // sm uses Button default

    const labelSize = size === "sm" ? "text-body-sm" : size === "lg" ? "text-body-lg" : "text-label";

    return (
      <div ref={ref} className={cn("inline-flex flex-col gap-1", className)}>
        <div className="inline-flex items-center gap-3">
          <span
            className={cn(
              labelSize,
              "tabular-nums",
              isInvalid ? "text-text-subtle" : "text-text-default",
            )}
          >
            {primary.display}
          </span>

          {multiNumber && alternateNumbers.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              disabled={isDisabled}
              aria-expanded={expanded}
              aria-label={expanded ? "Hide alternate numbers" : "Show alternate numbers"}
              className="inline-flex h-7 w-7 items-center justify-center rounded-radius-sm text-text-subtle hover:bg-surface-sunken hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}

          <Button
            type="button"
            variant="secondary"
            size={btnSize}
            iconOnly
            leadingIcon={Phone}
            disabled={isDisabled}
            onClick={() => primary.e164 && handleCall(primary.e164)}
            aria-label={isInvalid ? "Invalid phone number" : `Call ${primary.display}`}
            className={cn(btnSizeOverride, "rounded-radius-sm")}
          />
        </div>

        {expanded && alternateNumbers.length > 0 && (
          <ul
            className={cn(
              "mt-1 flex flex-col gap-1 rounded-radius-md border border-border-subtle bg-surface-elevated p-2 shadow-card",
            )}
          >
            {alternateNumbers.map((alt) => {
              const a = formatPhone(alt.phoneNumber, displayFormat);
              return (
                <li key={alt.label + alt.phoneNumber} className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-caption text-text-subtle">{alt.label}</span>
                    <span className={cn("text-label tabular-nums", a.valid ? "text-text-default" : "text-text-subtle")}>
                      {a.display}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    iconOnly
                    leadingIcon={Phone}
                    disabled={!a.valid || isDisabled}
                    onClick={() => a.e164 && handleCall(a.e164)}
                    aria-label={`Call ${alt.label} (${a.display})`}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {isInvalid && !disabled && (
          <p className="text-caption text-status-danger">Invalid number</p>
        )}
      </div>
    );
  },
);
PhoneWithClickToCall.displayName = "PhoneWithClickToCall";

export default PhoneWithClickToCall;
