/**
 * The terms a partner accepts, each in its own scrollable box: navigatr's
 * Referral Portal Terms first (every portal, not editable by the ISO, shown even
 * when "Powered by" is off because they are the platform's terms), then the ISO's
 * partner terms under "Partner terms" when the ISO has set any. Shared by the
 * invite page (first acceptance) and the terms page (accepting a changed version,
 * FR-PORT-18) so both read the same.
 */
import { NAVIGATR_PORTAL_TERMS_TITLE } from "../../../../../../supabase/functions/_shared/portalNavigatrTerms";

const BOX =
  "max-h-48 overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-radius-md border border-border-default bg-surface-sunken p-3 text-body-md text-text-default";

export function PortalTermsText({ navigatrText, isoText }: { navigatrText: string; isoText: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 id="portal-navigatr-terms-heading" className="text-body-strong text-text-default">
          {NAVIGATR_PORTAL_TERMS_TITLE}
        </h2>
        {/* A focusable scroll box is a named region, so a screen reader says which terms it holds. */}
        <div role="region" aria-labelledby="portal-navigatr-terms-heading" tabIndex={0} className={BOX}>
          {navigatrText}
        </div>
      </div>
      {isoText.trim() && (
        <div className="flex flex-col gap-2">
          <h2 id="portal-terms-heading" className="text-body-strong text-text-default">
            Partner terms
          </h2>
          <div role="region" aria-labelledby="portal-terms-heading" tabIndex={0} className={BOX}>
            {isoText}
          </div>
        </div>
      )}
    </div>
  );
}
