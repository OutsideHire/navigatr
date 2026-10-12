/**
 * One referral as the partner sees it (spec 5.6, FR-PORT-72): what they sent,
 * the current label, the label history with dates, and who at the ISO has it
 * (name and business email). While it is still Received the partner can
 * withdraw it (FR-PORT-42). Updates the ISO published on it (spec 5.7) show
 * newest first. Refreshes every 30 seconds.
 */
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Mail } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import { PortalLabelChip } from "../components/PortalLabelChip";
import {
  PORTAL_POLL_MS,
  PortalApiError,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
} from "../lib/portalApi";
import { formatPortalDate } from "../lib/portalFormat";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import { industryLabel, urgencyLabel } from "../../../../../../supabase/functions/_shared/portalSubmission";

const NOT_WITHDRAWABLE = "This referral is already being worked on, so it can no longer be pulled back.";

export function PortalReferralPage() {
  const { referralId = "" } = useParams<{ referralId: string }>();
  const { slug, token, brand, expire } = usePortalSignedIn();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const q = useQuery({
    queryKey: portalDataKey(slug, token, "referral", referralId),
    queryFn: () => portalApi.getReferral(slug, token, referralId),
    refetchInterval: PORTAL_POLL_MS,
    retry: false,
  });

  const unauthorized = isPortalUnauthorized(q.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  const back = (
    <Link
      to={`/p/${slug}/home`}
      className="inline-flex min-h-11 items-center gap-1 self-start text-body-sm text-brand-primary"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
      Back to your referrals
    </Link>
  );

  if (unauthorized || q.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  }

  // Retry only when nothing has loaded: a failed background poll keeps the last data.
  if (q.data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <PortalRetry name={brand.orgName} onRetry={() => void q.refetch()} busy={q.isFetching} />
      </div>
    );
  }

  if (!q.data) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Card padding="lg" className="flex flex-col gap-2">
          <h1 className="text-heading-lg text-text-default">We couldn&apos;t find that referral</h1>
          <p className="text-body-md text-text-muted">Check the link, or open it from your list.</p>
        </Card>
      </div>
    );
  }

  const r = q.data;
  // Defensive: a response from before Phase 1C has no updates key.
  const updates = r.updates ?? [];

  const withdraw = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await portalApi.withdrawReferral(slug, token, r.id);
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      if (err instanceof PortalApiError && err.code === "not_withdrawable") setNotice(NOT_WITHDRAWABLE);
      else if (isPortalTransientError(err)) setNotice(portalReachMessage(brand.orgName));
      else setNotice("We couldn't do that. Try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: portalDataKey(slug, token) });
    }
  };

  const details: Array<[string, string | null]> = [
    ["Contact", r.contactName],
    ["Email", r.contactEmail],
    ["Phone", r.contactPhone],
    ["Address", r.address],
    ["Industry", industryLabel(r.industry)],
    ["How soon", urgencyLabel(r.urgency)],
  ];
  const shown = details.filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-4">
      {back}

      <Card padding="lg" className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 break-words text-heading-lg text-text-default">{r.companyName}</h1>
          <PortalLabelChip label={r.label} />
        </div>
        <p className="text-caption text-text-muted">
          {r.ref} · Sent {formatPortalDate(r.submittedAt)}
        </p>
      </Card>

      {updates.length > 0 && (
        <Card padding="lg">
          <section className="flex flex-col gap-2">
            <h2 className="text-body-strong text-text-default">Updates from {brand.orgName}</h2>
            <ol className="flex flex-col gap-3">
              {updates.map((u, i) => (
                <li key={`${u.publishedAt}-${i}`} className="flex flex-col gap-1">
                  <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{u.body}</p>
                  <p className="text-caption text-text-muted">
                    {u.authorName ?? brand.orgName} · <time dateTime={u.publishedAt}>{formatPortalDate(u.publishedAt)}</time>
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </Card>
      )}

      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Your contact at {brand.orgName}</h2>
          {r.rep ? (
            <div className="flex flex-col gap-1">
              {r.rep.name && <span className="text-body-md text-text-default">{r.rep.name}</span>}
              {r.rep.email && (
                <a
                  href={`mailto:${r.rep.email}`}
                  className="inline-flex min-h-11 items-center gap-2 break-all text-body-md text-brand-primary"
                >
                  <Mail className="h-4 w-4 shrink-0" aria-hidden />
                  {r.rep.email}
                </a>
              )}
            </div>
          ) : (
            <p className="text-body-md text-text-muted">Someone at {brand.orgName} will pick this up soon.</p>
          )}
        </section>
      </Card>

      <Card padding="lg">
        <section className="flex flex-col gap-2">
          <h2 className="text-body-strong text-text-default">Progress</h2>
          <ol className="flex flex-col gap-2">
            {r.history.map((h, i) => (
              <li key={`${h.label}-${h.at}-${i}`} className="flex items-center justify-between gap-3">
                <span className="text-body-md text-text-default">{h.label}</span>
                <time dateTime={h.at} className="text-caption text-text-muted">
                  {formatPortalDate(h.at)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      </Card>

      {(shown.length > 0 || r.notes || r.detailsRemoved) && (
        <Card padding="lg">
          <section className="flex flex-col gap-2">
            <h2 className="text-body-strong text-text-default">What you sent</h2>
            {r.detailsRemoved && (
              <p className="text-body-md text-text-muted">Contact details for this referral were removed for privacy.</p>
            )}
            {shown.length > 0 && (
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                {shown.map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt className="text-caption text-text-subtle">{k}</dt>
                    <dd className="break-words text-body-md text-text-default">{v}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
            {r.notes && <p className="whitespace-pre-wrap text-body-md text-text-muted">{r.notes}</p>}
          </section>
        </Card>
      )}

      {notice && (
        <p role="alert" className="text-body-sm text-status-danger">
          {notice}
        </p>
      )}

      {r.canWithdraw &&
        (confirming ? (
          <Card padding="lg" className="flex flex-col gap-3">
            <p className="text-body-md text-text-default">
              Withdraw {r.companyName}? {brand.orgName} will not follow up on it.
            </p>
            <Button
              variant="destructive"
              size="lg"
              fullWidth
              loading={busy}
              disabled={busy}
              onClick={() => void withdraw()}
            >
              Yes, withdraw it
            </Button>
            <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </Card>
        ) : (
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={() => {
              setNotice(null);
              setConfirming(true);
            }}
          >
            Withdraw this referral
          </Button>
        ))}
    </div>
  );
}