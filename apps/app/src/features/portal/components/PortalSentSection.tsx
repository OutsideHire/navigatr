/**
 * "Sent to you" on the partner dashboard (FR-PORT-76): businesses the ISO
 * referred to this partner, kept apart from the referrals the partner sent.
 * It is the dashboard's second tab (Robert 2026-10-30: the two lists ran
 * together on a phone). Shares the dashboard's time period and refreshes every
 * 30 seconds. The dashboard reads the same query for the tab's count; React
 * Query shares the one request.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2 } from "lucide-react";
import { Card } from "@/components/navigatr";
import { PortalLabelChip } from "./PortalLabelChip";
import { PortalRetry } from "./PortalRetry";
import { PORTAL_POLL_MS, isPortalUnauthorized, portalApi, portalDataKey, type PortalWindow } from "../lib/portalApi";
import { formatPortalDate } from "../lib/portalFormat";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import { portalPath } from "../lib/portalAddress";

/** The partner's "Sent to you" list for a period. Signs out on a dead session. */
export function usePortalSentReferrals(period: PortalWindow) {
  const { slug, token, expire } = usePortalSignedIn();
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

  return q;
}

export function PortalSentSection({ period }: { period: PortalWindow }) {
  const { slug, brand } = usePortalSignedIn();
  const q = usePortalSentReferrals(period);

  if (!q.data && !q.isError) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }
  if (!q.data) {
    return <PortalRetry name={brand.orgName} busy={q.isFetching} onRetry={() => void q.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm text-text-muted">Businesses {brand.orgName} referred to you.</p>
      {q.data.length === 0 ? (
        <Card padding="lg">
          <p className="text-body-md text-text-muted">
            Nothing sent to you yet. When {brand.orgName} refers a business to you, it shows up here.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-radius-md border border-border-subtle bg-surface-default">
          {q.data.map((r) => (
            <li key={r.id}>
              <Link
                to={portalPath(slug, `/s/${r.id}`)}
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
      )}
    </div>
  );
}
