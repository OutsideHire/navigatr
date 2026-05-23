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
  STATUS_BADGE_KIND,
  STATUS_LABEL,
  TYPE_LABEL,
  formatRelativeLastTouch,
  formatShortDate,
  type Partner,
} from "../mockData";
import {
  STAGE_BADGE_KIND,
  STAGE_LABEL,
  formatMoney,
  type Deal,
} from "@/features/pipeline/mockData";
import { usePartner } from "../hooks/usePartner";
import { useAttributeDeal, useUnattributeDeal } from "../hooks/useAttributeDeal";
import { useUpdatePartner } from "../hooks/useUpdatePartner";
import { usePartnerActivities, type PartnerTouch, type PartnerTouchType } from "../hooks/usePartnerActivities";
import { useLogPartnerTouch } from "../hooks/useLogPartnerTouch";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { Loader2, X, Check, MessageSquare } from "lucide-react";
import { Select, type SelectOption, Textarea } from "@/components/navigatr";
import { type PartnerStatus } from "../mockData";

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
}: {
  partner: Partner;
  dealCount: number;
  totalRevenue: number;
  onLogTouch: () => void;
}) {
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

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="md"
          leadingIcon={Plus}
          onClick={onLogTouch}
        >
          Log touch
        </Button>
        {/* Edit is now inline: click the status pill above, or click
            Edit on the Notes card below. A top-bar "edit everything"
            button would need a sheet that doesn't exist yet. */}
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

function NotesCard({ partner }: { partner: Partner }) {
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
      toast.success("Notes saved");
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
          <h2 className="text-body-strong text-text-default">Notes</h2>
        </div>
        <Textarea
          id={`partner-notes-${partner.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Anything worth remembering about this partner — meeting cadence, referral patterns, hot buttons."
          rows={5}
          className="w-full"
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
        <h2 className="text-body-strong text-text-default">Notes</h2>
        <Button variant="tertiary" size="sm" leadingIcon={Pencil} onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
      {partner.notes ? (
        <p className="whitespace-pre-wrap text-body-md text-text-default">{partner.notes}</p>
      ) : (
        <p className="text-body-md text-text-muted">No notes yet. Click Edit to add some.</p>
      )}
    </Card>
  );
}

function ReferralsCard({
  partnerId,
  attributedDeals,
  allDeals,
}: {
  partnerId: string;
  attributedDeals: Deal[];
  allDeals: Deal[];
}) {
  const navigate = useNavigate();
  const attribute = useAttributeDeal();
  const unattribute = useUnattributeDeal();
  const [picking, setPicking] = React.useState(false);
  const [pickedDealId, setPickedDealId] = React.useState<string>("");

  // Eligible = every deal in the org that isn't already attributed to
  // THIS partner. (A deal can be attributed to multiple partners — the
  // link table allows it — so we only filter against this partner's set.)
  const attributedIds = React.useMemo(
    () => new Set(attributedDeals.map((d) => d.id)),
    [attributedDeals],
  );
  const eligibleOptions = React.useMemo<SelectOption[]>(
    () =>
      allDeals
        .filter((d) => !attributedIds.has(d.id))
        .map((d) => ({ value: d.id, label: `${d.companyName} · ${formatMoney(d.valueCents)}` })),
    [allDeals, attributedIds],
  );

  const handleAttach = async () => {
    if (!pickedDealId) return;
    try {
      await attribute.mutateAsync({ partnerId, dealId: pickedDealId });
      toast.success("Deal attributed");
      setPicking(false);
      setPickedDealId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not attribute deal");
    }
  };

  const handleUnlink = async (dealId: string) => {
    try {
      await unattribute.mutateAsync({ partnerId, dealId });
      toast.success("Attribution removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove attribution");
    }
  };

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-body-strong text-text-default">Referrals · {attributedDeals.length}</h2>
        {!picking && eligibleOptions.length > 0 && (
          <Button variant="tertiary" size="sm" leadingIcon={Plus} onClick={() => setPicking(true)}>
            Attach deal
          </Button>
        )}
      </div>

      {picking && (
        <div className="mb-3 flex items-end gap-2 rounded-radius-md border border-border-subtle bg-surface-sunken p-3">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-caption text-text-muted" htmlFor={`attach-deal-${partnerId}`}>
              Attach a deal to this partner
            </label>
            <Select
              id={`attach-deal-${partnerId}`}
              value={pickedDealId}
              onValueChange={setPickedDealId}
              options={eligibleOptions}
              placeholder="Pick a deal…"
            />
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={handleAttach}
            disabled={!pickedDealId || attribute.isPending}
          >
            {attribute.isPending ? "Attaching…" : "Attach"}
          </Button>
          <Button
            variant="tertiary"
            size="md"
            onClick={() => { setPicking(false); setPickedDealId(""); }}
          >
            Cancel
          </Button>
        </div>
      )}

      {attributedDeals.length === 0 ? (
        <p className="text-body-md text-text-muted">
          No deals attributed yet.
          {eligibleOptions.length > 0 && !picking && " Click “Attach deal” to link one."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {attributedDeals.map((d) => (
            <div
              key={d.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-radius-md border border-border-subtle bg-surface-default p-3",
                "focus-within:ring-2 focus-within:ring-brand-primary focus-within:ring-offset-2 focus-within:ring-offset-surface-canvas",
              )}
            >
              <button
                type="button"
                onClick={() => navigate(`/pipeline/${d.id}`)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left transition-colors hover:opacity-80 focus-visible:outline-none"
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
              <button
                type="button"
                onClick={() => handleUnlink(d.id)}
                disabled={unattribute.isPending}
                aria-label={`Remove attribution for ${d.companyName}`}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-md text-text-subtle",
                  "transition-colors hover:bg-status-danger-bg hover:text-status-danger",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
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
            <Textarea
              id={`touch-notes-${partnerId}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Discussed Q4 referral pipeline. They've got two restaurants closing on financing this month."
              className="w-full"
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

  const deals = React.useMemo<Deal[]>(() => {
    if (!partner) return [];
    const byId = new Map(allDeals.map((d) => [d.id, d]));
    return partner.attributedDealIds.map((id) => byId.get(id)).filter(Boolean) as Deal[];
  }, [partner, allDeals]);

  const totalRevenue = React.useMemo(
    () => deals.reduce((sum, d) => sum + d.valueCents, 0),
    [deals],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
      </div>
    );
  }

  if (!partner) return <NotFound />;

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
          dealCount={deals.length}
          totalRevenue={totalRevenue}
          onLogTouch={openLogTouch}
        />
        <ContactCard partner={partner} />
        <NotesCard partner={partner} />
        <TouchTimelineCard
          ref={timelineRef}
          partnerId={partner.id}
          open={logTouchOpen}
          onOpenChange={setLogTouchOpen}
        />
        <ReferralsCard partnerId={partner.id} attributedDeals={deals} allDeals={allDeals} />
      </div>
    </div>
  );
}

export default PartnerDetailPage;
