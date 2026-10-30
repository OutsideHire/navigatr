/**
 * The public referral form's one line about navigatr's own Referral Portal
 * Terms: "By sending, you agree to the Navigatr Referral Portal Terms." The
 * title is a button that opens and closes the full text in the same scrollable
 * box the signed-in portal uses. There is no second checkbox: sending is the
 * agreement, and portal_public_submit records the version (the edge passes its
 * own constant). Shown even when "Powered by navigatr" is off, because these are
 * the platform's terms, not branding.
 */
import * as React from "react";
import {
  NAVIGATR_PORTAL_TERMS_TEXT,
  NAVIGATR_PORTAL_TERMS_TITLE,
} from "../../../../../../supabase/functions/_shared/portalNavigatrTerms";
import { TERMS_BOX_CLASS } from "./PortalTermsText";

export function PublicFormNavigatrTerms() {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const boxId = `${id}-navigatr-terms`;
  const toggleId = `${id}-navigatr-terms-toggle`;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm text-text-muted">
        By sending, you agree to the{" "}
        <button
          type="button"
          id={toggleId}
          aria-expanded={open}
          aria-controls={boxId}
          onClick={() => setOpen((v) => !v)}
          className="-my-2 inline py-2 text-left font-medium text-brand-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          {NAVIGATR_PORTAL_TERMS_TITLE}
        </button>
        .
      </p>
      {/* Always in the page so aria-controls resolves; hidden while closed. A
          focusable scroll box is a named region, so a screen reader says which terms it holds. */}
      <div
        id={boxId}
        role="region"
        aria-labelledby={toggleId}
        tabIndex={0}
        hidden={!open}
        className={TERMS_BOX_CLASS}
      >
        {NAVIGATR_PORTAL_TERMS_TEXT}
      </div>
    </div>
  );
}
