/**
 * Partner detail — /partners/:partnerId.
 *
 * Surfaces:
 *   Hero card     : avatar + name + company + status badge + actions
 *   Contact info  : phone (click-to-call), email, city
 *   Notes         : free-text from the partner record
 *   Referrals     : deals attributed to this partner, cross-referenced
 *                   from MOCK_DEALS. Each row links to /pipeline/:dealId.
 *   Touch history : (placeholder for Sprint 2 — needs activity-by-partner
 *                   linkage in the data model)
 *
 * Sprint 1: client-side lookup against MOCK_PARTNERS. If id missing →
 * not-found state with a back CTA (same pattern as DealDetailPage).
 */

import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Mail,
  MapPin,
  Pencil,
  PhoneIcon,
  Plus,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Avatar,
  Badge,
  Button,
  Card,
  PhoneWithClickToCall,
} from "@/components/navigatr";

import {
  MOCK_PARTNERS,
  STATUS_BADGE_KIND,
  STATUS_LABEL,
  TYPE_LABEL,
  formatRelativeLastTouch,
  formatShortDate,
  type Partner,
} from "../mockData";
import {
  MOCK_DEALS,
  STAGE_BADGE_KIND,
  STAGE_LABEL,
  formatMoney,
  type Deal,
} from "@/features/pipeline/mockData";

// ── Not found ──────────────────────────────────────────────────────

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-4 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <Users className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-heading-sm text-text-default">Partner not found</p>
        <p className="text-body-md text-text-muted">
          This partner may have been removed or you're looking at someone else&apos;s book.
        </p>
      </div>
      <Button variant="primary" size="md" leadingIcon={ArrowLeft} onClick={() => navigate("/partners")}>
        Back to partners
      </Button>
    </div>
  );
}

// ── Cards ─────────────────────────────────────────────────────────

function HeroCard({ partner, dealCount, totalRevenue }: { partner: Partner; dealCount: number; totalRevenue: number }) {
  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <Avatar alt={partner.name} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-eyebrow text-text-muted">
            PARTNER · {TYPE_LABEL[partner.type].toUpperCase()}
          </p>
          <h1 className="text-heading-lg text-text-default">{partner.name}</h1>
          <p className="text-body-md text-text-muted">
            <Building2 className="mr-1 inline h-4 w-4 -translate-y-0.5 text-text-subtle" aria-hidden />
            {partner.company}
          </p>
        </div>
        <Badge kind={STATUS_BADGE_KIND[partner.status]}>{STATUS_LABEL[partner.status]}</Badge>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-radius-md bg-surface-sunken p-3">
          <span className="text-eyebrow text-text-subtle">REFERRALS</span>
          <span className="text-kpi-md tabular-nums text-text-default">{dealCount}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-radius-md bg-surface-sunken p-3">
          <span className="text-eyebrow text-text-subtle">ATTRIBUTED</span>
          <span className="text-kpi-md tabular-nums text-text-default">
            {totalRevenue > 0 ? formatMoney(totalRevenue) : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-radius-md bg-surface-sunken p-3">
          <span className="text-eyebrow text-text-subtle">LAST TOUCH</span>
          <span className="text-body-strong tabular-nums text-text-default">
            {formatRelativeLastTouch(partner.lastTouch)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="md"
          leadingIcon={Plus}
          onClick={() => toast("Partner activity logging lands in Sprint 2")}
        >
          Log touch
        </Button>
        <Button
          variant="secondary"
          size="md"
          leadingIcon={Pencil}
          onClick={() => toast("Partner editing lands in Sprint 2")}
        >
          Edit
        </Button>
      </div>
    </Card>
  );
}

function ContactCard({ partner }: { partner: Partner }) {
  return (
    <Card padding="md">
      <h2 className="mb-3 text-body-strong text-text-default">Contact</h2>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-teal-20 text-accent-teal">
            <PhoneIcon className="h-4 w-4" aria-hidden />
          </span>
          <PhoneWithClickToCall phoneNumber={partner.phone} size="sm" />
        </div>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-blue-20 text-accent-blue">
            <Mail className="h-4 w-4" aria-hidden />
          </span>
          <a href={`mailto:${partner.email}`} className="truncate text-body-md text-text-default hover:underline">
            {partner.email}
          </a>
        </div>
        {partner.city && (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
              <MapPin className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-body-md text-text-default">{partner.city}</span>
          </div>
        )}
        {partner.nextFollowup && (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-orange-20 text-accent-orange">
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-body-md text-text-default">
              Next follow-up: <span className="tabular-nums">{formatShortDate(partner.nextFollowup)}</span>
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

function NotesCard({ partner }: { partner: Partner }) {
  if (!partner.notes) return null;
  return (
    <Card padding="md">
      <h2 className="mb-2 text-body-strong text-text-default">Notes</h2>
      <p className="whitespace-pre-wrap text-body-md text-text-default">{partner.notes}</p>
    </Card>
  );
}

function ReferralsCard({ deals }: { deals: Deal[] }) {
  const navigate = useNavigate();
  return (
    <Card padding="md">
      <h2 className="mb-3 text-body-strong text-text-default">Referrals · {deals.length}</h2>
      {deals.length === 0 ? (
        <p className="text-body-md text-text-muted">No deals attributed yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {deals.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => navigate(`/pipeline/${d.id}`)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-radius-md border border-border-subtle bg-surface-default p-3 text-left transition-colors",
                "hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
              )}
            >
              <div className="flex min-w-0 flex-col">
                <p className="truncate text-body-strong text-text-default">{d.companyName}</p>
                <p className="truncate text-caption text-text-muted">{d.contactName}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-body-strong tabular-nums text-text-default">{formatMoney(d.valueCents)}</span>
                <Badge kind={STAGE_BADGE_KIND[d.stage]}>{STAGE_LABEL[d.stage]}</Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────

export function PartnerDetailPage() {
  const { partnerId } = useParams<{ partnerId: string }>();
  const navigate = useNavigate();

  const partner = React.useMemo(
    () => MOCK_PARTNERS.find((p) => p.id === partnerId),
    [partnerId],
  );

  const deals = React.useMemo<Deal[]>(() => {
    if (!partner) return [];
    const byId = new Map(MOCK_DEALS.map((d) => [d.id, d]));
    return partner.attributedDealIds.map((id) => byId.get(id)).filter(Boolean) as Deal[];
  }, [partner]);

  const totalRevenue = React.useMemo(
    () => deals.reduce((sum, d) => sum + d.valueCents, 0),
    [deals],
  );

  if (!partner) return <NotFound />;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mb-3">
        <Button
          variant="tertiary"
          size="sm"
          leadingIcon={ArrowLeft}
          onClick={() => navigate("/partners")}
        >
          Back to partners
        </Button>
      </div>

      <div className="flex flex-col gap-4 lg:gap-6">
        <HeroCard partner={partner} dealCount={deals.length} totalRevenue={totalRevenue} />
        <ContactCard partner={partner} />
        {partner.notes && <NotesCard partner={partner} />}
        <ReferralsCard deals={deals} />
      </div>
    </div>
  );
}

export default PartnerDetailPage;
