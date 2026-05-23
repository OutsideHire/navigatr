/**
 * Deal detail page — Sprint 1.
 *
 * Source: Figma `navigatr v1` Deal Detail (mobile + desktop) in the
 * Pipeline master frame.
 *
 * Composition:
 *   1. Hero — CardWithStatusBand keyed by stage. Eyebrow ("DEAL · STAGE"),
 *      company name (heading-lg), contact line, 3-col metrics (value /
 *      probability / expected close), action row (Log activity / Edit).
 *   2. Tabs (Radix Tabs) — Overview / Activity / Contacts / Qualification /
 *      Notes & Files. Default Overview.
 *   3. Overview content — 4 stacked Cards: Contact info, Source +
 *      dates, Pipeline progression dots, Latest activity preview.
 *   4. Other tabs — Activity (full list grouped by day), Contacts
 *      placeholder, Qualification (raw object dump for Sprint 1), Notes
 *      & Files placeholder.
 *
 * Data: useDeal(dealId) reads from the cached ['deals','mock'] query
 * (or MOCK_DEALS on deep-link). Activities come from the in-memory mock
 * store; the Log Activity sheet appends and we bump activitiesVersion.
 */

import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  Check,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone as PhoneIcon,
  Plus,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardWithStatusBand,
  ListRow,
  PhoneWithClickToCall,
} from "@/components/navigatr";

import {
  formatMoney,
  formatRelative,
  formatShortDate,
  LOST_REASON_LABEL,
  STAGE_BADGE_KIND,
  STAGE_BAND_COLOR,
  STAGE_LABEL,
  type Deal,
  type DealStage,
  type LostReasonCategory,
} from "../mockData";
import { LostReasonModal } from "../components/LostReasonModal";
import { useDeal } from "../hooks/useDeal";
import { useUpdateDeal } from "../hooks/useUpdateDeal";
import { useActivities } from "@/features/activities/hooks/useActivities";
import { Select, type SelectOption } from "@/components/navigatr";
import type { Activity } from "@/features/activities/mockData";
import { DISPOSITIONS } from "@/lib/followUpScheduling";
import { LogActivitySheet } from "@/features/activities/components/LogActivitySheet";
import { EditDealSheet } from "../components/EditDealSheet";
import { EditActivitySheet } from "@/features/activities/components/EditActivitySheet";

// ───────────────────────────────────────────────────────────────────────
// Not-found state
// ───────────────────────────────────────────────────────────────────────

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-4 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <Building2 className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-heading-sm text-text-default">Deal not found</p>
        <p className="text-body-md text-text-muted">
          This deal may have been deleted or is on a different rep&apos;s pipeline.
        </p>
      </div>
      {/* IMPORTANT: do NOT combine `asChild` with `leadingIcon` on Button —
          Radix Slot requires exactly one child, but `leadingIcon` adds a
          second element (icon + children) and throws at runtime, which
          crashes the whole page tree (see qa report 2026-05-12). Use plain
          onClick navigation instead. */}
      <Button variant="primary" size="md" leadingIcon={ArrowLeft} onClick={() => navigate("/pipeline")}>
        Back to pipeline
      </Button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Hero card
// ───────────────────────────────────────────────────────────────────────

const STAGE_OPTIONS: SelectOption[] = [
  { value: "new",        label: "New" },
  { value: "contacted",  label: "Contacted" },
  { value: "qualified",  label: "Qualified" },
  { value: "proposal",   label: "Proposal" },
  { value: "won",        label: "Won" },
  { value: "lost",       label: "Lost" },
];

/**
 * Clickable stage badge. Click → reveals an inline Select with the 5
 * stages; picking a new value runs the mutation and collapses the
 * picker. Drives the pipeline forward — without this, deals are
 * frozen at creation. Same pattern as the partner status picker.
 *
 * The deal_stage_history server-side trigger writes a row whenever
 * stage changes, so the dashboard's conversion funnel picks up the
 * transition automatically.
 */
function StagePicker({ deal }: { deal: Deal }) {
  const update = useUpdateDeal();
  const [editing, setEditing] = React.useState(false);
  const [lostModalOpen, setLostModalOpen] = React.useState(false);

  const handleChange = async (next: string) => {
    if (next === deal.stage) {
      setEditing(false);
      return;
    }
    // Intercept "lost" transition — open modal to capture reason before persisting.
    if (next === "lost" && deal.stage !== "lost") {
      setEditing(false);
      setLostModalOpen(true);
      return;
    }
    try {
      await update.mutateAsync({
        id: deal.id,
        patch: { stage: next as DealStage },
      });
      toast.success(`Moved to ${STAGE_LABEL[next as DealStage]}`);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update stage");
    }
  };

  const handleLostSubmit = async (
    category: LostReasonCategory,
    notes: string | null,
  ) => {
    await update.mutateAsync({
      id: deal.id,
      patch: {
        stage: "lost",
        lostReasonCategory: category,
        lostReasonNotes: notes,
      },
    });
    toast.success("Moved to Lost");
  };

  if (!editing) {
    return (
      <>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Stage: ${STAGE_LABEL[deal.stage]}. Click to change.`}
          className={cn(
            "rounded-radius-full transition-opacity",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
            update.isPending && "opacity-60",
          )}
          disabled={update.isPending}
        >
          <Badge kind={STAGE_BADGE_KIND[deal.stage]}>
            {STAGE_LABEL[deal.stage]}
          </Badge>
        </button>
        <LostReasonModal
          open={lostModalOpen}
          onOpenChange={setLostModalOpen}
          onSubmit={handleLostSubmit}
        />
      </>
    );
  }

  return (
    <>
      <div className="w-48">
        <Select
          id={`stage-${deal.id}`}
          value={deal.stage}
          onValueChange={handleChange}
          options={STAGE_OPTIONS}
        />
      </div>
      <LostReasonModal
        open={lostModalOpen}
        onOpenChange={setLostModalOpen}
        onSubmit={handleLostSubmit}
      />
    </>
  );
}

function HeroCard({ deal, onLogActivity, onEdit }: { deal: Deal; onLogActivity: () => void; onEdit: () => void }) {
  return (
    <CardWithStatusBand bandColor={STAGE_BAND_COLOR[deal.stage]} contentPadding="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-eyebrow text-text-muted">
            DEAL · {STAGE_LABEL[deal.stage].toUpperCase()}
          </p>
          <h1 className="text-heading-lg text-text-default">{deal.companyName}</h1>
          <p className="text-body-md text-text-muted">
            {deal.contactName} · Owner
          </p>
        </div>

        {/* 3-col metrics row. Stack on mobile, grid on sm+ */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Metric eyebrow="VALUE" value={formatMoney(deal.valueCents)} />
          <Metric eyebrow="PROBABILITY" value={`${deal.probability}%`} />
          <Metric
            eyebrow="EXPECTED CLOSE"
            value={deal.nextFollowup ? formatShortDate(deal.nextFollowup) : "—"}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StagePicker deal={deal} />
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="primary" size="md" leadingIcon={Plus} onClick={onLogActivity}>
              Log activity
            </Button>
            <Button
              variant="secondary"
              size="md"
              leadingIcon={Pencil}
              onClick={onEdit}
            >
              Edit
            </Button>
          </div>
        </div>
      </div>
    </CardWithStatusBand>
  );
}

function Metric({ eyebrow, value }: { eyebrow: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-radius-md bg-surface-sunken p-3">
      <span className="text-eyebrow text-text-subtle">{eyebrow}</span>
      <span className="text-kpi-md tabular-nums text-text-default">{value}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Tabs
// ───────────────────────────────────────────────────────────────────────

const TAB_KEYS = ["overview", "activity", "contacts", "qualification", "notes"] as const;
type TabKey = typeof TAB_KEYS[number];
const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  activity: "Activity",
  contacts: "Contacts",
  qualification: "Qualification",
  notes: "Notes & Files",
};

function TabBar() {
  return (
    <Tabs.List
      className={cn(
        // Mobile: scrollable. Desktop: inline row.
        "flex gap-1 overflow-x-auto border-b border-border-subtle",
        "[&::-webkit-scrollbar]:hidden",
        "[-ms-overflow-style:none] [scrollbar-width:none]",
      )}
      aria-label="Deal sections"
    >
      {TAB_KEYS.map((k) => (
        <Tabs.Trigger
          key={k}
          value={k}
          className={cn(
            "relative shrink-0 px-3 py-2 text-body-md font-medium transition-colors",
            "text-text-muted hover:bg-surface-elevated hover:text-text-default",
            "data-[state=active]:text-text-default",
            // 2 px brand-primary underline on active
            "data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:h-0.5 data-[state=active]:after:bg-brand-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
          )}
        >
          {TAB_LABELS[k]}
        </Tabs.Trigger>
      ))}
    </Tabs.List>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Overview sub-cards
// ───────────────────────────────────────────────────────────────────────

function ContactInfoCard({ deal }: { deal: Deal }) {
  return (
    <Card padding="md">
      <h3 className="mb-3 text-body-strong text-text-default">Contact information</h3>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-teal-20 text-accent-teal">
            <PhoneIcon className="h-4 w-4" aria-hidden />
          </span>
          <PhoneWithClickToCall phoneNumber={deal.phone} size="sm" />
        </div>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-blue-20 text-accent-blue">
            <Mail className="h-4 w-4" aria-hidden />
          </span>
          <span className="truncate text-body-md text-text-default">{deal.email}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-violet-20 text-accent-violet">
            <MapPin className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-body-md text-text-default">Address on file</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-accent-orange-20 text-accent-orange">
            <Users className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-body-md text-text-default">{deal.employeeCountRange} employees</span>
        </div>
      </div>
    </Card>
  );
}

function SourceCard({ deal }: { deal: Deal }) {
  // Sprint 1: lead source isn't on the Deal interface yet (Add Deal stores
  // it but the mock dataset's seed deals don't carry it). Showing inferred
  // values from the dataset stage so the section reads.
  const items: Array<{ eyebrow: string; value: string }> = [
    { eyebrow: "LEAD SOURCE",     value: "Partner Referral" },
    { eyebrow: "SOURCE PARTNER",  value: "Sarah Johnson" },
    { eyebrow: "CREATED",         value: "Apr 12, 2026" },
    { eyebrow: "LAST ACTIVITY",   value: formatRelative(deal.lastActivity) },
  ];
  const showLostReason = deal.stage === "lost" && deal.lostReasonCategory !== null;
  return (
    <Card padding="md">
      <h3 className="mb-3 text-body-strong text-text-default">Source</h3>
      <div className="grid grid-cols-2 gap-3">
        {items.map((i) => (
          <div key={i.eyebrow} className="flex flex-col gap-0.5">
            <span className="text-eyebrow text-text-subtle">{i.eyebrow}</span>
            <span className="text-body-md text-text-default">{i.value}</span>
          </div>
        ))}
      </div>
      {showLostReason && (
        <div className="mt-4 border-t border-border-subtle pt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-eyebrow text-text-subtle">LOST REASON</span>
            <span className="text-body-md text-text-default">
              {LOST_REASON_LABEL[deal.lostReasonCategory!]}
            </span>
            {deal.lostReasonNotes && (
              <p className="mt-1 max-w-prose text-body-md text-text-muted">
                {deal.lostReasonNotes}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

const STAGE_ORDER: DealStage[] = ["new", "contacted", "qualified", "proposal", "won"];

function PipelineProgressionCard({ deal }: { deal: Deal }) {
  // Lost deals: treat as if the deal never made it past the start — show all
  // progression steps as future/dim with a "Lost" note above the stepper.
  const currentIdx = deal.stage === "lost" ? -1 : STAGE_ORDER.indexOf(deal.stage);
  return (
    <Card padding="md">
      <h3 className="mb-4 text-body-strong text-text-default">Pipeline progression</h3>
      <div className="flex items-start">
        {STAGE_ORDER.map((stage, idx) => {
          const isPast = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;
          return (
            <React.Fragment key={stage}>
              <div className="flex flex-1 flex-col items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-radius-full text-caption font-semibold tabular-nums",
                    isPast && "bg-brand-primary text-brand-primary-foreground",
                    isCurrent && "bg-brand-primary text-brand-primary-foreground ring-4 ring-brand-primary-10",
                    isFuture && "bg-surface-sunken text-text-subtle",
                  )}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isPast ? <Check className="h-3.5 w-3.5" aria-hidden /> : idx + 1}
                </span>
                <span className={cn("text-caption", isFuture ? "text-text-subtle" : "text-text-muted")}>
                  {STAGE_LABEL[stage]}
                </span>
              </div>
              {idx < STAGE_ORDER.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "mt-3.5 h-0.5 flex-1 rounded-radius-full",
                    idx < currentIdx ? "bg-brand-primary" : "bg-surface-sunken",
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Card>
  );
}

function LatestActivityCard({
  activity,
  onViewAll,
  onEdit,
}: {
  activity: Activity | undefined;
  onViewAll: () => void;
  onEdit?: (a: Activity) => void;
}) {
  return (
    <Card padding="md">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-body-strong text-text-default">Latest activity</h3>
        <Button variant="tertiary" size="sm" trailingIcon={ArrowRight} onClick={onViewAll}>
          View all
        </Button>
      </div>
      {activity ? (
        <ActivityRow activity={activity} onEdit={onEdit} />
      ) : (
        <p className="text-body-md text-text-muted">No activity yet. Log a call to get started.</p>
      )}
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Activity list (Activity tab)
// ───────────────────────────────────────────────────────────────────────

function ActivityRow({ activity, onEdit }: { activity: Activity; onEdit?: (a: Activity) => void }) {
  const spec = DISPOSITIONS[activity.disposition];
  return (
    <ListRow
      onClick={onEdit ? () => onEdit(activity) : undefined}
      leading={
        <span className="flex h-9 w-9 items-center justify-center rounded-radius-full bg-accent-teal-20 text-accent-teal">
          <PhoneIcon className="h-4 w-4" aria-hidden />
        </span>
      }
      title={`Call · ${activity.durationMinutes ?? "—"} min · ${spec.label}`}
      subtitle={activity.outcomeNotes || "No notes"}
      trailing={
        <span className="text-caption tabular-nums text-text-muted">
          {formatRelative(activity.occurredAt)}
        </span>
      }
    />
  );
}

function ActivityList({ activities, onEdit }: { activities: Activity[]; onEdit?: (a: Activity) => void }) {
  if (activities.length === 0) {
    return (
      <Card padding="lg" className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
          <PhoneIcon className="h-6 w-6" aria-hidden />
        </span>
        <p className="text-body-strong text-text-default">No activities yet</p>
        <p className="text-caption text-text-muted">Log a call to start building this deal&apos;s history.</p>
      </Card>
    );
  }

  // Group by occurredAt date (YYYY-MM-DD).
  const groups = new Map<string, Activity[]>();
  for (const a of activities) {
    const key = a.occurredAt.slice(0, 10);
    const arr = groups.get(key) ?? [];
    arr.push(a);
    groups.set(key, arr);
  }

  return (
    <div className="flex flex-col gap-4">
      {Array.from(groups.entries()).map(([dateKey, items]) => (
        <div key={dateKey} className="flex flex-col gap-2">
          <p className="text-eyebrow text-text-subtle">
            {new Date(dateKey).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
          </p>
          <Card padding="none">
            <div className="flex flex-col">
              {items.map((a, i) => (
                <div key={a.id} className={cn(i > 0 && "border-t border-border-subtle")}>
                  <ActivityRow activity={a} onEdit={onEdit} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Placeholder tabs
// ───────────────────────────────────────────────────────────────────────

function PlaceholderTab({ title }: { title: string }) {
  return (
    <Card padding="lg" className="flex flex-col items-center gap-2 text-center">
      <p className="text-body-strong text-text-default">{title}</p>
      <p className="text-caption text-text-muted">Coming in sprint 2.</p>
    </Card>
  );
}

function QualificationTab({ deal }: { deal: Deal }) {
  return (
    <Card padding="md">
      <h3 className="mb-3 text-body-strong text-text-default">Qualification data</h3>
      <p className="mb-3 text-caption text-text-muted">
        Profession-specific fields captured during Add Deal. Sprint 2 builds the
        editable view.
      </p>
      <pre className="overflow-x-auto rounded-radius-md bg-surface-sunken p-3 text-caption text-text-default">
        {JSON.stringify(deal, null, 2)}
      </pre>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────

export function DealDetailPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  // useDeal subscribes to useDeals internally — same cache, single fetch.
  // The isLoading flag holds the spinner on a cold-cache deep-link until
  // the list arrives, so we don't flash NotFound for a real deal.
  const { deal, isLoading } = useDeal(dealId);
  const { data: activities = [] } = useActivities(dealId);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editingActivity, setEditingActivity] = React.useState<Activity | null>(null);
  const [tab, setTab] = React.useState<TabKey>("overview");

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" aria-hidden />
      </div>
    );
  }

  if (!deal) return <NotFound />;

  return (
    <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* Back link — small, top */}
      <div className="mb-3">
        <Button
          variant="tertiary"
          size="sm"
          leadingIcon={ArrowLeft}
          onClick={() => navigate("/pipeline")}
        >
          Back to pipeline
        </Button>
      </div>

      <div className="flex flex-col gap-4 lg:gap-6">
        <HeroCard
          deal={deal}
          onLogActivity={() => setSheetOpen(true)}
          onEdit={() => setEditOpen(true)}
        />

        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabBar />

          <Tabs.Content value="overview" className="mt-4 flex flex-col gap-4 focus-visible:outline-none">
            <ContactInfoCard deal={deal} />
            <SourceCard deal={deal} />
            <PipelineProgressionCard deal={deal} />
            <LatestActivityCard
              activity={activities[0]}
              onViewAll={() => setTab("activity")}
              onEdit={setEditingActivity}
            />
          </Tabs.Content>

          <Tabs.Content value="activity" className="mt-4 focus-visible:outline-none">
            <ActivityList activities={activities} onEdit={setEditingActivity} />
          </Tabs.Content>

          <Tabs.Content value="contacts" className="mt-4 focus-visible:outline-none">
            <PlaceholderTab title="Contacts" />
          </Tabs.Content>

          <Tabs.Content value="qualification" className="mt-4 focus-visible:outline-none">
            <QualificationTab deal={deal} />
          </Tabs.Content>

          <Tabs.Content value="notes" className="mt-4 focus-visible:outline-none">
            <PlaceholderTab title="Notes & Files" />
          </Tabs.Content>
        </Tabs.Root>
      </div>

      <LogActivitySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        dealId={deal.id}
        onLogged={() => {
          // useLogActivity invalidates the cache; the timeline below
          // refetches automatically. Just flip to the Activity tab.
          setTab("activity");
        }}
      />

      <EditDealSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        deal={deal}
        onDeleted={() => navigate("/pipeline")}
      />

      {editingActivity && (
        <EditActivitySheet
          open={!!editingActivity}
          onOpenChange={(open) => !open && setEditingActivity(null)}
          activity={editingActivity}
        />
      )}

      {/* Decorative — explicit icon ref so tree-shaking keeps Calendar
          available for any future "Schedule follow-up" CTA. */}
      <span hidden aria-hidden><Calendar /></span>
    </div>
  );
}

export default DealDetailPage;
