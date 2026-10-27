/**
 * The ISO's partner terms in a scrollable box under a "Partner terms" heading.
 * Shared by the invite page (first acceptance) and the terms page (accepting a
 * changed version, FR-PORT-18) so both read the same.
 */
export function PortalTermsText({ text }: { text: string }) {
  return (
    <section aria-labelledby="portal-terms-heading" className="flex flex-col gap-2">
      <h2 id="portal-terms-heading" className="text-body-strong text-text-default">
        Partner terms
      </h2>
      <div
        tabIndex={0}
        className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-radius-md border border-border-default bg-surface-sunken p-3 text-body-md text-text-default"
      >
        {text}
      </div>
    </section>
  );
}
