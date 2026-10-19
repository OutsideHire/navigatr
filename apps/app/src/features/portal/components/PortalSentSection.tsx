/**
 * "Sent to you" on the partner dashboard (FR-PORT-76): businesses the ISO
 * referred to this partner, kept apart from the referrals the partner sent.
 * Shares the dashboard's time period, refreshes every 30 seconds, and shows
 * nothing until there is something to show (a failed load hides it too; the
 * main list above has its own retry).
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { PortalLabelChip } from "./PortalLabelChip";
import { PORTAL_POLL_MS, isPortalUnauthorized, portalApi, portalDataKey, type PortalWindow } from "../lib/portalApi";
import { formatPortalDate } from "../lib/portalFormat";
import { usePortalSignedIn } from "../lib/portalSignedIn";

export function PortalSentSection({ period }: { period: PortalWindow }) {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const q = useQuery({
    queryKey: portalDataKey(slug, token, "sent", period),
    queryFn: () => portalApi.listSentReferrals(slug, token, period),
    refetchInterval: PORTAL_POLL_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const unauthorized = isPortalUnauthorized(q.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  if (!q.data || q.data.length === 0) return null;

  return (
    <section aria-labelledby="portal-sent-heading" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 id="portal-sent-heading" className="text-heading-sm text-text-default">
          Sent to you
        </h2>
        <p className="text-body-sm text-text-muted">Businesses {brand.orgName} referred to you.</p>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-radius-md border border-border-subtle bg-surface-default">
        {q.data.map((r) => (
          <li key={r.id}>
            <Link
              to={`/p/${slug}/s/${r.id}`}
              className="flex min-h-14 items-center gap-3 px-3 py-3 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-body-strong text-text-default">{r.companyName}</span>
                <span className="text-caption text-text-muted">
                  {r.ref} · Sent {formatPortalDate(r.sentAt)}
                </span>
              </span>
              <PortalLabelChip label={r.label} />
              <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
