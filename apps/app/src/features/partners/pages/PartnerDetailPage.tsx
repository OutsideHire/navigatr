/**
 * Partner detail — /partners/:partnerId.
 *
 * Surfaces:
 *   Hero card     : avatar + name + company + status badge + actions
 *   Contact info  : phone (click-to-call), email, city
 *   Notes         : free-text from the partner record
 *   Referrals     : deals attributed to this partner, cross-referenced
 *                   from MOCK_DEALS. Each row links to /pipeline/:dealId.
 *   Touch history : per-partner interaction timeline (partner_activities) with
 *                   an inline log-touch form — TouchTimelineCard.
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
  STATUS_BADGE_KIND,
  STATUS_LABEL,
  TYPE_LABEL,
  formatRelativeLastTouch,
  formatShortDate,
  type Partner,
} from "../mockData";
import {
  formatMoney,
  type Deal,
} from "@/features/pipeline/mockData";
import { computeCadenceStatus, formatCadence, cadenceSignalLabel } from "../partnerCadence";
import { formatCalendarDate } from "@/lib/calendarDate";
import { usePartner } from "../hooks/usePartner";
import { useAttributeDeal, useUnattributeDeal } from "../hooks/useAttributeDeal";
import { useReferDeal } from "../hooks/useReferDeal";
import { useUpdatePartner } from "../hooks/useUpdatePartner";
import { usePartnerActivities, type PartnerTouch, type PartnerTouchType } from "../hooks/usePartnerActivities";
import { useLogPartnerTouch } from "../hooks/useLogPartnerTouch";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { Loader2, Check, MessageSquare } from "lucide-react";
import { Select, type SelectOption, NotesFieldWithMic } from "@/components/navigatr";
import { ReferralSection } from "../components/ReferralSection";
import { type PartnerStatus } from "../mockData";
import { useProfile } from "@/features/auth/useProfile";
import { useAuth } from "@/stores/auth";
import { EditPartnerSheet } from "../components/EditPartnerSheet";
import { PartnerNotesCard } from "../components/PartnerNotesCard";
import { ReferralPreviewSheet } from "../components/ReferralPreviewSheet";

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

function HeroCard({
  partner,
  dealCount,
  totalRevenue,
  onLogTouch,
  canEdit,
  onEdit,
}: {
  partner: Partner;
  dealCount: number;
  totalRevenue: number;
  onLogTouch: () => void;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const currentUserId = useAuth((s) => s.user?.id);
  // FR-HIER-05: show the owner only when it isn't the viewer's own partner.
  const showOwner = Boolean(
    partner.ownerName && partner.ownerId && partner.ownerId !== currentUserId,
  );
  const cadence = computeCadenceStatus(
    {
      followupCadenceDays: partner.followupCadenceDays,
      lastTouch: partner.lastTouch,
      createdAt: partner.createdAt,
    },
    new Date(),
  );
  const cadenceSignal = cadenceSignalLabel(cadence);
  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <Avatar alt={partner.name} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-eyebrow text-text-muted">
            PARTNER · {(TYPE_LABEL[partner.type] ?? partner.type).toUpperCase()}
          </p>
          <h1 className="text-heading-lg text-text-default">{partner.name}</h1>
          <p className="text-body-md text-text-muted">
            <Building2 className="mr-1 inline h-4 w-4 -translate-y-0.5 text-text-subtle" aria-hidden />
            {partner.company}
          </p>
          {showOwner && (
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-body-sm text-text-muted">
              <Avatar alt={partner.ownerName!} size="xs" />
              <span className="truncate">Owner: {partner.ownerName}</span>
            </p>
          )}
        </div>
        <StatusPicker partner={partner} />
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

      {cadence.hasCadence && (
        <div className="flex flex-wrap items-center gap-2 text-body-md text-text-muted">
          <span className="text-text-default">{formatCadence(partner.followupCadenceDays ?? null)}</span>
          {cadenceSignal ? (
            <span
              className={cn(
                "rounded-radius-full px-2 py-0.5 text-caption font-medium",
                cadence.state === "overdue"
                  ? "bg-status-danger-bg text-status-danger"
                  : "bg-status-warning-bg text-status-warning",
              )}
            >
              {cadenceSignal}
            </span>
          ) : (
            cadence.dueAt && <span>· next due {formatCalendarDate(cadence.dueAt)}</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="md"
          leadingIcon={Plus}
          onClick={onLogTouch}
        >
          Log touch
        </Button>
        {canEdit && (
          <Button
            variant="secondary"
            size="md"
            leadingIcon={Pencil}
            onClick={onEdit}
          >
            Edit
          </Button>
        )}
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

const STATUS_OPTIONS: SelectOption[] = [
  { value: "active",   label: "Active" },
  { value: "cooling",  label: "Cooling" },
  { value: "inactive", label: "Inactive" },
];

/** Clickable status pill. Click → reveals an inline Select; pick a new
 *  value → optimistically mutates and collapses. The whole interaction
 *  is keyboard-accessible (the badge is a real button). */
function StatusPicker({ partner }: { partner: Partner }) {
  const update = useUpdatePartner();
  const [editing, setEditing] = React.useState(false);

  const handleChange = async (next: string) => {
    if (next === partner.status) {
      setEditing(false);
      return;
    }
    try {
      await update.mutateAsync({
        id: partner.id,
        patch: { status: next as PartnerStatus },
      });
      toast.success(`Status set to ${STATUS_LABEL[next as PartnerStatus]}`);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status");
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Status: ${STATUS_LABEL[partner.status]}. Click to change.`}
        className={cn(
          "rounded-radius-full transition-opacity",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
          update.isPending && "opacity-60",
        )}
        disabled={update.isPending}
      >
        <Badge kind={STATUS_BADGE_KIND[partner.status]}>
          {STATUS_LABEL[partner.status]}
        </Badge>
      </button>
    );
  }

  return (
    <div className="w-40">
      <Select
        id={`status-${partner.id}`}
        value={partner.status}
        onValueChange={handleChange}
        options={STATUS_OPTIONS}
      />
    </div>
  );
}

function AboutCard({ partner }: { partner: Partner }) {
  const update = useUpdatePartner();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(partner.notes);

  // When the partner prop changes (e.g. after a different partner is
  // selected, or the cache refetches with updated notes), reset the
  // draft so we don't keep stale text from a prior edit session.
  React.useEffect(() => {
    setDraft(partner.notes);
  }, [partner.notes]);

  const handleSave = async () => {
    if (draft.trim() === partner.notes.trim()) {
      setEditing(false);
      return;
    }
    try {
      await update.mutateAsync({ id: partner.id, patch: { notes: draft } });
      toast.success("About saved");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save notes");
    }
  };

  const handleCancel = () => {
    setDraft(partner.notes);
    setEditing(false);
  };

  // Render path 1: editing — textarea + Save / Cancel
  if (editing) {
    return (
      <Card padding="md">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-body-strong text-text-default">About</h2>
        </div>
        <NotesFieldWithMic
          id={`partner-notes-${partner.id}`}
          value={draft}
          onChange={setDraft}
          placeholder="Anything worth remembering about this partner. Meeting cadence, referral patterns, hot buttons."
          rows={5}
        />
        <div className="mt-3 flex gap-2">
          <Button variant="primary" size="sm" leadingIcon={Check} onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
          <Button variant="tertiary" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
        </div>
      </Card>
    );
  }

  // Render path 2: read-only display
  return (
    <Card padding="md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-body-strong text-text-default">About</h2>
        <Button variant="tertiary" size="sm" leadingIcon={Pencil} onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
      {partner.notes ? (
        <p className="whitespace-pre-wrap text-body-md text-text-default">{partner.notes}</p>
      ) : (
        <p className="text-body-md text-text-muted">No summary yet. Click Edit to add one.</p>
      )}
    </Card>
  );
}

// ── Touch timeline (with inline log-touch form) ──────────────────

const TOUCH_TYPE_OPTIONS: SelectOption[] = [
  { value: "call",    label: "Call" },
  { value: "email",   label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "note",    label: "Note" },
];

const TOUCH_TYPE_LABEL: Record<PartnerTouchType, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
};

/** Self-contained card: log-touch form (collapsible) + chronological
 *  timeline. The "Log touch" button at the top scrolls into view from
 *  the HeroCard CTA via the openExternal prop. */
const TouchTimelineCard = React.forwardRef<
  HTMLDivElement,
  { partnerId: string; open: boolean; onOpenChange: (open: boolean) => void }
>(function TouchTimelineCard({ partnerId, open, onOpenChange }, ref) {
  const activities = usePartnerActivities(partnerId);
  const logTouch = useLogPartnerTouch();

  const [type, setType] = React.useState<PartnerTouchType>("call");
  const [notes, setNotes] = React.useState("");
  const [durationStr, setDurationStr] = React.useState("");
  const [followUp, setFollowUp] = React.useState("");

  const reset = () => {
    setType("call");
    setNotes("");
    setDurationStr("");
    setFollowUp("");
  };

  const handleSubmit = async () => {
    const duration = durationStr ? Number.parseInt(durationStr, 10) : null;
    if (duration !== null && Number.isNaN(duration)) {
      toast.error("Duration must be a number");
      return;
    }
    try {
      await logTouch.mutateAsync({
        partnerId,
        type,
        notes: notes.trim(),
        durationMinutes: duration,
        // Convert YYYY-MM-DD from <input type="date"> to ISO midnight UTC.
        followUpDate: followUp ? new Date(followUp + "T00:00:00Z").toISOString() : null,
      });
      toast.success("Touch logged");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log touch");
    }
  };

  const touches = activities.data ?? [];

  return (
    <Card padding="md" ref={ref}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-body-strong text-text-default">Touch history · {touches.length}</h2>
        {!open && (
          <Button
            variant="tertiary"
            size="sm"
            leadingIcon={Plus}
            onClick={() => onOpenChange(true)}
          >
            Log touch
          </Button>
        )}
      </div>

      {/* Inline log-touch form — collapsible. */}
      {open && (
        <div className="mb-4 flex flex-col gap-3 rounded-radius-md border border-border-subtle bg-surface-sunken p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-caption text-text-muted" htmlFor={`touch-type-${partnerId}`}>
                Type
              </label>
              <Select
                id={`touch-type-${partnerId}`}
                value={type}
                onValueChange={(v) => setType(v as PartnerTouchType)}
                options={TOUCH_TYPE_OPTIONS}
              />
            </div>
            <div>
              <label className="mb-1 block text-caption text-text-muted" htmlFor={`touch-duration-${partnerId}`}>
                Duration (minutes) <span className="text-text-subtle">— optional</span>
              </label>
              <input
                id={`touch-duration-${partnerId}`}
                type="number"
                inputMode="numeric"
                min={0}
                value={durationStr}
                onChange={(e) => setDurationStr(e.target.value)}
                placeholder="e.g. 15"
                className="block w-full rounded-radius-md border border-border-subtle bg-surface-default px-3 py-2 text-body-md text-text-default focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-caption text-text-muted" htmlFor={`touch-notes-${partnerId}`}>
              What happened?
            </label>
            <NotesFieldWithMic
              id={`touch-notes-${partnerId}`}
              value={notes}
              onChange={setNotes}
              rows={3}
              placeholder="Discussed Q4 referral pipeline. They've got two restaurants closing on financing this month."
            />
          </div>

          <div>
            <label className="mb-1 block text-caption text-text-muted" htmlFor={`touch-followup-${partnerId}`}>
              Next follow-up <span className="text-text-subtle">— optional</span>
            </label>
            <input
              id={`touch-followup-${partnerId}`}
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="block rounded-radius-md border border-border-subtle bg-surface-default px-3 py-2 text-body-md text-text-default focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              leadingIcon={Check}
              onClick={handleSubmit}
              disabled={logTouch.isPending}
            >
              {logTouch.isPending ? "Saving…" : "Save touch"}
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {activities.isLoading && (
        <div className="flex h-24 items-center justify-center text-caption text-text-muted">
          Loading touches…
        </div>
      )}
      {activities.isError && (
        <div className="rounded-radius-md bg-status-danger-bg p-3 text-body-sm text-status-danger">
          Couldn&apos;t load touch history. Refresh to try again.
        </div>
      )}
      {!activities.isLoading && !activities.isError && touches.length === 0 && (
        <p className="text-body-md text-text-muted">
          No touches logged yet. {open ? "Save your first one above." : "Click “Log touch” to record one."}
        </p>
      )}
      {touches.length > 0 && (
        <div className="flex flex-col gap-2">
          {touches.map((t) => (
            <TouchRow key={t.id} touch={t} />
          ))}
        </div>
      )}
    </Card>
  );
});

function TouchRow({ touch }: { touch: PartnerTouch }) {
  const dateLabel = formatShortDate(touch.occurredAt);
  const followUpLabel = touch.followUpDate
    ? `Next: ${formatShortDate(touch.followUpDate)}`
    : null;
  return (
    <div className="flex items-start gap-3 rounded-radius-md border border-border-subtle bg-surface-default p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-blue-20 text-accent-blue">
        <MessageSquare className="h-4 w-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-body-strong text-text-default">{TOUCH_TYPE_LABEL[touch.type]}</span>
          {touch.durationMinutes != null && (
            <span className="text-caption text-text-muted">{touch.durationMinutes} min</span>
          )}
          <span className="text-caption text-text-subtle">· {dateLabel}</span>
          {followUpLabel && (
            <span className="text-caption font-medium text-accent-orange">· {followUpLabel}</span>
          )}
        </div>
        {touch.notes && (
          <p className="whitespace-pre-wrap text-body-sm text-text-default">{touch.notes}</p>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────

export function PartnerDetailPage() {
  const { partnerId } = useParams<{ partnerId: string }>();
  const navigate = useNavigate();

  // usePartner subscribes to usePartners — same cache as /partners list.
  const { partner, isLoading } = usePartner(partnerId);
  const { data: allDeals = [] } = useDeals();

  // Referral mutations owned at the page level; ReferralSection stays
  // data-agnostic and the parent supplies onAdd/onRemove + toasts.
  const attribute = useAttributeDeal();
  const referDeal = useReferDeal();
  const unattribute = useUnattributeDeal();

  const profile = useProfile();
  const currentUserId = useAuth((s) => s.user?.id);
  const [editOpen, setEditOpen] = React.useState(false);
  const [previewDeal, setPreviewDeal] = React.useState<Deal | null>(null);

  // HeroCard's "Log touch" button toggles this; TouchTimelineCard reads
  // it. When the form opens, we also scroll the timeline card into view
  // so the form is visible without the user hunting for it.
  const [logTouchOpen, setLogTouchOpen] = React.useState(false);
  const timelineRef = React.useRef<HTMLDivElement | null>(null);
  const openLogTouch = React.useCallback(() => {
    setLogTouchOpen(true);
    // Defer scroll until after the form renders so we land on the
    // expanded card height, not the collapsed one.
    requestAnimationFrame(() => {
      timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const inboundDeals = React.useMemo<Deal[]>(() => {
    if (!partner) return [];
    const byId = new Map(allDeals.map((d) => [d.id, d]));
    return partner.attributedDealIds.map((id) => byId.get(id)).filter(Boolean) as Deal[];
  }, [partner, allDeals]);
  const outboundDeals = React.useMemo<Deal[]>(() => {
    if (!partner) return [];
    const byId = new Map(allDeals.map((d) => [d.id, d]));
    return partner.outboundDealIds.map((id) => byId.get(id)).filter(Boolean) as Deal[];
  }, [partner, allDeals]);
  const linkedIds = React.useMemo(
    () => new Set([...(partner?.attributedDealIds ?? []), ...(partner?.outboundDealIds ?? [])]),
    [partner],
  );
  const eligibleOptions = React.useMemo(
    () =>
      allDeals
        .filter((d) => !linkedIds.has(d.id))
        .map((d) => ({ value: d.id, label: `${d.companyName} · ${formatMoney(d.valueCents)}` })),
    [allDeals, linkedIds],
  );

  // KPIs stay inbound-only.
  const totalRevenue = React.useMemo(
    () => inboundDeals.reduce((sum, d) => sum + d.valueCents, 0),
    [inboundDeals],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
      </div>
    );
  }

  if (!partner) return <NotFound />;

  const canEdit =
    profile.data?.role === "manager" ||
    profile.data?.role === "admin" ||
    (!!partner.createdBy && partner.createdBy === currentUserId);

  return (
    <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
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
        <HeroCard
          partner={partner}
          dealCount={inboundDeals.length}
          totalRevenue={totalRevenue}
          onLogTouch={openLogTouch}
          canEdit={canEdit}
          onEdit={() => setEditOpen(true)}
        />
        <ContactCard partner={partner} />
        <AboutCard partner={partner} />
        <PartnerNotesCard partnerId={partner.id} />
        <TouchTimelineCard
          ref={timelineRef}
          partnerId={partner.id}
          open={logTouchOpen}
          onOpenChange={setLogTouchOpen}
        />
        <ReferralSection
          title="Referred to us"
          deals={inboundDeals}
          eligibleOptions={eligibleOptions}
          addLabel="Attach deal"
          emptyText="No deals attributed yet."
          onSelectDeal={setPreviewDeal}
          onAdd={async (dealId) => {
            try {
              await attribute.mutateAsync({ partnerId: partner.id, dealId });
              toast.success("Deal attributed");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not attribute deal");
              throw err;
            }
          }}
          onRemove={async (dealId) => {
            try {
              await unattribute.mutateAsync({ partnerId: partner.id, dealId });
              toast.success("Attribution removed");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not remove attribution");
              throw err;
            }
          }}
        />
        <ReferralSection
          title="Referred to them"
          deals={outboundDeals}
          eligibleOptions={eligibleOptions}
          addLabel="Refer a deal"
          emptyText="No deals referred to this partner yet."
          onSelectDeal={setPreviewDeal}
          onAdd={async (dealId) => {
            try {
              await referDeal.mutateAsync({ partnerId: partner.id, dealId });
              toast.success("Deal referred");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not refer deal");
              throw err;
            }
          }}
          onRemove={async (dealId) => {
            try {
              await unattribute.mutateAsync({ partnerId: partner.id, dealId });
              toast.success("Referral removed");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not remove referral");
              throw err;
            }
          }}
        />
        <EditPartnerSheet open={editOpen} onOpenChange={setEditOpen} partner={partner} />
        <ReferralPreviewSheet
          deal={previewDeal}
          open={previewDeal !== null}
          onOpenChange={(o) => { if (!o) setPreviewDeal(null); }}
        />
      </div>
    </div>
  );
}

export default PartnerDetailPage;
