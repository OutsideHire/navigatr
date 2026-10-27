/**
 * Partner dashboard (spec 5.6, FR-PORT-68..70): send a referral, see how the
 * partner's referrals are doing, open any one of them. Tiles and list share one
 * time period and refresh every 30 seconds. Value appears only when the ISO
 * allows it (the server omits it otherwise). Referrals the ISO sent to the
 * partner are listed separately under Sent to you (Phase 2B-3).
 */
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, Loader2, Plus } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { cn } from "@/lib/utils";
import { PortalRetry, portalReachMessage } from "../components/PortalRetry";
import { PortalLabelChip } from "../components/PortalLabelChip";
import { PortalSentSection } from "../components/PortalSentSection";
import {
  PORTAL_POLL_MS,
  isPortalTransientError,
  isPortalUnauthorized,
  portalApi,
  portalDataKey,
  type PortalWindow,
} from "../lib/portalApi";
import { buildReferralsCsv, downloadCsv, referralsCsvFilename } from "../lib/portalCsv";
import { formatConversion, formatPortalDate, formatPortalMoney } from "../lib/portalFormat";
import { usePortalSignedIn } from "../lib/portalSignedIn";
import { PORTAL_WINDOWS } from "../../../../../../supabase/functions/_shared/portalSubmission";
import { PORTAL_LABELS, type PortalLabel } from "../../../../../../supabase/functions/_shared/portalLabels";

function Tile({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex min-h-20 flex-col justify-between gap-1 rounded-radius-md border border-border-subtle bg-surface-default p-3">
      <span className="text-caption text-text-muted">{label}</span>
      <span className={cn("tabular-nums text-text-default", small ? "text-body-sm" : "text-heading-sm")}>{value}</span>
    </div>
  );
}

export function PortalDashboardPage() {
  const { slug, token, brand, expire } = usePortalSignedIn();
  const navigate = useNavigate();
  const [period, setPeriod] = React.useState<PortalWindow>("all");
  // Narrows the rendered list by partner label (FR-PORT-75). Client-side only: the
  // query and the CSV export stay period-scoped.
  const [statusFilter, setStatusFilter] = React.useState<PortalLabel | "all">("all");

  const stats = useQuery({
    queryKey: portalDataKey(slug, token, "dashboard", period),
    queryFn: () => portalApi.dashboard(slug, token, period),
    refetchInterval: PORTAL_POLL_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const list = useQuery({
    queryKey: portalDataKey(slug, token, "list", period),
    queryFn: () => portalApi.listReferrals(slug, token, period),
    refetchInterval: PORTAL_POLL_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const unauthorized = isPortalUnauthorized(stats.error) || isPortalUnauthorized(list.error);
  React.useEffect(() => {
    if (unauthorized) expire();
  }, [unauthorized, expire]);

  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const data = await portalApi.exportReferrals(slug, token, period);
      downloadCsv(referralsCsvFilename(slug, new Date()), buildReferralsCsv(data));
    } catch (err) {
      if (isPortalUnauthorized(err)) {
        expire();
        return;
      }
      setExportError(
        isPortalTransientError(err) ? portalReachMessage(brand.orgName) : "We couldn't build the file. Try again.",
      );
    } finally {
      setExporting(false);
    }
  };

  let content: React.ReactNode;
  if (unauthorized || (!stats.data && !stats.isError) || (!list.data && !list.isError)) {
    content = (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-label="Loading" />
      </div>
    );
  } else if (!stats.data || !list.data) {
    content = (
      <PortalRetry
        name={brand.orgName}
        busy={stats.isFetching || list.isFetching}
        onRetry={() => {
          void stats.refetch();
          void list.refetch();
        }}
      />
    );
  } else {
    const s = stats.data;
    const referrals = list.data;
    const visible = statusFilter === "all" ? referrals : referrals.filter((r) => r.label === statusFilter);
    content = (
      <>
        <section aria-label="Summary" className="grid grid-cols-2 gap-2">
          <Tile label="Submitted" value={String(s.submitted)} />
          <Tile label="Active" value={String(s.active)} />
          <Tile label="Closed Won" value={String(s.closedWon)} />
          <Tile label="Conversion rate" value={formatConversion(s.conversionRate)} small={s.conversionRate === null} />
          {s.valueVisible && typeof s.totalValueCents === "number" && (
            <Tile label="Total value" value={formatPortalMoney(s.totalValueCents)} />
          )}
        </section>

        {referrals.length === 0 ? (
          <Card padding="lg">
            <p className="text-body-md text-text-muted">
              Nothing here yet. Send {brand.orgName} a business and follow it here.
            </p>
          </Card>
        ) : (
          <>
            <div role="group" aria-label="Status filter" className="flex flex-wrap gap-1">
              {(["all", ...PORTAL_LABELS] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={statusFilter === f}
                  onClick={() => setStatusFilter(f)}
                  className={cn(
                    "min-h-11 rounded-radius-sm px-3 text-caption font-medium",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
                    statusFilter === f ? "bg-surface-default text-text-default shadow-card" : "bg-surface-sunken text-text-muted",
                  )}
                >
                  {f === "all" ? "All" : f}
                </button>
              ))}
            </div>
            {visible.length === 0 ? (
              <Card padding="lg">
                <p className="text-body-md text-text-muted">Nothing marked {statusFilter}.</p>
              </Card>
            ) : (
          <ul className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-radius-md border border-border-subtle bg-surface-default">
            {visible.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/p/${slug}/r/${r.id}`}
                  className="flex min-h-14 items-center gap-3 px-3 py-3 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-body-strong text-text-default">{r.companyName}</span>
                    <span className="text-caption text-text-muted">
                      {r.ref} · Updated {formatPortalDate(r.lastActivityAt)}
                    </span>
                  </span>
                  <PortalLabelChip label={r.label} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
            )}
          </>
        )}

        {referrals.length > 0 && (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              leadingIcon={Download}
              loading={exporting}
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              Download CSV
            </Button>
            {exportError && (
              <p role="alert" className="text-body-sm text-status-danger">
                {exportError}
              </p>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h1 className="text-heading-lg text-text-default">Your referrals</h1>
        <Button variant="primary" size="lg" fullWidth leadingIcon={Plus} onClick={() => navigate(`/p/${slug}/new`)}>
          Send a referral
        </Button>
      </div>

      <div role="group" aria-label="Time period" className="grid grid-cols-4 gap-1 rounded-radius-md bg-surface-sunken p-1">
        {PORTAL_WINDOWS.map((w) => (
          <button
            key={w.value}
            type="button"
            aria-pressed={period === w.value}
            onClick={() => {
              setPeriod(w.value);
              // An export error was about the previous period.
              setExportError(null);
            }}
            className={cn(
              "min-h-11 rounded-radius-sm px-1 text-caption font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
              period === w.value ? "bg-surface-default text-text-default shadow-card" : "text-text-muted",
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {content}

      <PortalSentSection period={period} />
    </div>
  );
}
