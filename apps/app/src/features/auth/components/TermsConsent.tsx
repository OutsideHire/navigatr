/**
 * TermsConsent, the "I agree to the Terms of Service and Privacy Policy"
 * clickwrap shown on every account-creation form (self-serve signup, invited
 * rep, create-workspace). Purely presentational: it reports the checkbox state
 * via callback and renders the error it's given, so the form owns validation +
 * wiring and this stays trivial to unit-test.
 *
 * The checkbox's own label carries the full agreement sentence (its accessible
 * name); the Terms / Privacy documents open in a new tab so the reader never
 * loses their half-filled signup form. The ref forwards to the checkbox control
 * so react-hook-form can focus + scroll to it when consent is the failed field.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/navigatr";

export interface TermsConsentProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Validation message shown when consent is required but missing. */
  error?: string;
  /** Disable while the form is submitting. */
  disabled?: boolean;
  id?: string;
}

export const TermsConsent = React.forwardRef<HTMLButtonElement, TermsConsentProps>(function TermsConsent(
  { checked, onCheckedChange, error, disabled, id = "agree-terms" },
  ref,
) {
  return (
    <div className="flex flex-col gap-1">
      <Checkbox
        ref={ref}
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        label="I agree to the Terms of Service and Privacy Policy"
      />
      <p className="pl-8 text-caption text-text-muted">
        Read the{" "}
        <Link
          to="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-primary underline underline-offset-2"
        >
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link
          to="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-primary underline underline-offset-2"
        >
          Privacy Policy
        </Link>
        .
      </p>
      {error && (
        <p className="pl-8 text-caption text-status-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
