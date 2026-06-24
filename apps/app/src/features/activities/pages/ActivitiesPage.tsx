/**
 * Activities — the rep's daily action surface.
 *
 * Three tabs:
 *   Today      — overdue + due-today follow-ups, derived from each
 *                activity's followUpDate. Each task is the next-touch
 *                for a deal, computed by the smart follow-up scheduler
 *                when the previous activity was logged.
 *   Upcoming   — next 7 days grouped by day (Mon, Tue, …)
 *   History    — every logged activity, newest first, filterable by
 *                type (call / email / drop_in / appointment)
 *
 * Data: useActivitiesForOrg() + useDeals() (both RLS-scoped to the
 * user's org_id server-side). useLogActivity invalidates both caches
 * on success — there is no client-side mutation here.
 *
 * Mobile-first single column. Desktop centers at max-w-5xl. Each task
 * row exposes a "Log activity" CTA that opens LogActivitySheet
 * pre-filled with the deal id. Snooze is a Sprint 2 stub (toast).
 */

import * as React from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Calendar,
  Check as CheckIcon,
  Clock,
  Mail,
  MapPin,
  Phone as PhoneIcon,
  PlusCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, Card, Chip } from "@/components/navigatr";
import { type Activity, type ActivityType } from "../mockData";
import { type Deal } from "@/features/pipeline/mockData";
import { DISPOSITIONS, formatFollowUpDate } from "@/lib/followUpScheduling";
import { LogActivitySheet } from "../components/LogActivitySheet";
import { UnloggedCallsSection } from "../components/UnloggedCallsSection";
import { useActivitiesForOrg } from "../hooks/useActivities";
import { useDeals } from "@/features/pipeline/hooks/useDeals";

// ── Date helpers ──────────────────────────────────────────────────────

/** Start-of-day UTC for the given date — used for "is this today?" math. */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function formatRelativeShort(iso: string, now: Date): string {
  const d = daysBetween(now, new Date(iso));
  if (d < -1) return `${Math.abs(d)}d overdue`;
  if (d === -1) return "1d overdue";
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due ${formatFollowUpDate(iso)}`;
}

function formatPastRelative(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return "over a year ago";
}

function dayHeading(iso: string, now: Date): string {
  const d = daysBetween(now, new Date(iso));
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  // Otherwise "Mon, May 18". timeZone: 'UTC' so the rendered date stays
  // consistent with the UTC-based grouping key elsewhere in this file
  // (everything uses UTC: startOfDay() sets UTC hours, dueAt.slice(0,10)
  // is a UTC date prefix). Without this, a PST user could see a "May 16"
  // label under a UTC-2026-05-17 group key — same task surfaces under the
  // wrong day heading.
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ── Task derivation ───────────────────────────────────────────────────

/** A "task" is a scheduled next-touch derived from a prior activity's
 *  followUpDate. We don't store tasks separately — they're a view of
 *  the activity history. */
interface DerivedTask {
  /** The activity whose followUpDate produced this task. */
  fromActivity: Activity;
  deal: Deal;
  dueAt: string; // ISO
}

/** Derive next-touches from live activity + deal data. Each activity
 *  with a `followUpDate` produces one task; tasks are sorted by due
 *  date asc so the page's overdue/today/upcoming bucketing is stable. */
function deriveTasks(activities: Activity[], deals: Deal[]): DerivedTask[] {
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const tasks: DerivedTask[] = [];
  for (const a of activities) {
    if (!a.followUpDate) continue;
    const deal = dealById.get(a.dealId);
    if (!deal) continue; // Activity orphaned by a deleted deal — skip.
    tasks.push({ fromActivity: a, deal, dueAt: a.followUpDate });
  }
  return tasks.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

// ── Row components ────────────────────────────────────────────────────

const TYPE_ICON: Record<ActivityType, typeof PhoneIcon> = {
  call: PhoneIcon,
  email: Mail,
  drop_in: MapPin,
  appointment: Calendar,
};
const TYPE_ACCENT: Record<ActivityType, { bg: string; fg: string }> = {
  call:        { bg: "bg-accent-teal-20",   fg: "text-accent-teal"   },
  email:       { bg: "bg-accent-blue-20",   fg: "text-accent-blue"   },
  drop_in:     { bg: "bg-accent-violet-20", fg: "text-accent-violet" },
  appointment: { bg: "bg-accent-orange-20", fg: "text-accent-orange" },
};
const TYPE_LABEL: Record<ActivityType, string> = {
  call: "Call",
  email: "Email",
  drop_in: "Drop-in",
  appointment: "Appointment",
};

function TaskRow({
  task,
  now,
  onLog,
}: {
  task: DerivedTask;
  now: Date;
  onLog: (dealId: string) => void;
}) {
  const overdue = daysBetween(now, new Date(task.dueAt)) < 0;
  const spec = DISPOSITIONS[task.fromActivity.disposition];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-radius-md border p-4 sm:flex-row sm:items-center sm:justify-between",
        overdue
          ? "border-status-danger/30 bg-status-danger-bg/50"
          : "border-border-subtle bg-surface-default",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full",
            overdue ? "bg-status-danger text-text-inverse" : "bg-brand-primary-10 text-brand-primary",
          )}
          aria-hidden
        >
          <Clock className="h-4 w-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-body-strong text-text-default">{task.deal.companyName}</p>
          <p className="text-caption text-text-muted">
            <span className={overdue ? "font-medium text-status-danger" : "text-text-default"}>
              {formatRelativeShort(task.dueAt, now)}
            </span>
            {" · "}from {spec.label}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 self-stretch sm:self-auto">
        <Button
          variant="primary"
          size="sm"
          leadingIcon={PlusCircle}
          onClick={() => onLog(task.deal.id)}
          className="flex-1 sm:flex-none"
        >
          Log activity
        </Button>
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => toast("Snooze lands in sprint 2")}
        >
          Snooze
        </Button>
      </div>
    </div>
  );
}

function HistoryRow({
  activity,
  deal,
  now,
  onOpenDeal,
}: {
  activity: Activity;
  deal: Deal | undefined;
  now: Date;
  onOpenDeal: (id: string) => void;
}) {
  const Icon = TYPE_ICON[activity.type];
  const accent = TYPE_ACCENT[activity.type];
  const dispoLabel = DISPOSITIONS[activity.disposition].label;
  const subtitle = [
    activity.durationMinutes ? `${activity.durationMinutes} min` : null,
    dispoLabel,
  ].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpenDeal(activity.dealId)}
      className={cn(
        "flex w-full items-start gap-3 rounded-radius-md border border-border-subtle bg-surface-default p-4 text-left transition-colors",
        "hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
      )}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full", accent.bg, accent.fg)} aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-body-strong text-text-default">
          {TYPE_LABEL[activity.type]} · {deal?.companyName ?? "Unknown deal"}
        </p>
        <p className="truncate text-caption text-text-muted">{subtitle}</p>
        {activity.outcomeNotes && (
          <p className="line-clamp-2 text-caption text-text-default">{activity.outcomeNotes}</p>
        )}
      </div>
      <span className="shrink-0 text-caption tabular-nums text-text-muted">
        {formatPastRelative(activity.occurredAt, now)}
      </span>
    </button>
  );
}

// ── Empty states ──────────────────────────────────────────────────────

function EmptyTodayCard() {
  return (
    <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-status-success-bg text-status-success">
        <CheckIcon className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-strong text-text-default">All caught up</p>
        <p className="text-caption text-text-muted">No tasks due today. Time to find new prospects.</p>
      </div>
    </Card>
  );
}

function EmptyUpcomingCard() {
  return (
    <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <Calendar className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-strong text-text-default">No upcoming tasks</p>
        <p className="text-caption text-text-muted">
          Log an activity from any deal to schedule the next touch.
        </p>
      </div>
    </Card>
  );
}

function EmptyHistoryCard() {
  const navigate = useNavigate();
  return (
    <Card padding="lg" className="flex flex-col items-center gap-3 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <PhoneIcon className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-strong text-text-default">No activities logged yet</p>
        <p className="text-caption text-text-muted">
          Log your first call from any deal in the Pipeline.
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={() => navigate("/pipeline")}>
        Go to Pipeline
      </Button>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

const TYPE_FILTERS: Array<"all" | ActivityType> = ["all", "call", "email", "drop_in", "appointment"];

function typeFilterLabel(f: "all" | ActivityType): string {
  return f === "all" ? "All" : TYPE_LABEL[f];
}

export function ActivitiesPage() {
  const navigate = useNavigate();
  const [tab, setTab] = React.useState<"today" | "upcoming" | "history">("today");
  const [typeFilter, setTypeFilter] = React.useState<"all" | ActivityType>("all");
  const [logSheetDealId, setLogSheetDealId] = React.useState<string | null>(null);
  const [logSheetOpen, setLogSheetOpen] = React.useState(false);

  // Pin "now" once per mount so the bucketing doesn't drift mid-session.
  // TODO: re-pin on tab visibility change so a rep who leaves the app
  // open overnight gets a fresh "today" on next focus.
  const now = React.useMemo(() => new Date(), []);

  // Live data — useLogActivity invalidates both keys on success, so
  // newly logged activities surface without a refreshKey hack.
  const { data: activities = [] } = useActivitiesForOrg();
  const { data: deals = [] } = useDeals();

  const dealById = React.useMemo(
    () => new Map(deals.map((d) => [d.id, d])),
    [deals],
  );

  const tasks = React.useMemo(
    () => deriveTasks(activities, deals),
    [activities, deals],
  );

  const { overdue, today, upcoming } = React.useMemo(() => {
    const groups = { overdue: [] as DerivedTask[], today: [] as DerivedTask[], upcoming: [] as DerivedTask[] };
    for (const t of tasks) {
      const delta = daysBetween(now, new Date(t.dueAt));
      if (delta < 0) groups.overdue.push(t);
      else if (delta === 0) groups.today.push(t);
      else if (delta <= 7) groups.upcoming.push(t);
      // beyond 7 days = ignored (out of view for sprint 1)
    }
    return groups;
  }, [tasks, now]);

  // Group upcoming by day so the UI renders day-headed buckets.
  const upcomingByDay = React.useMemo(() => {
    const map = new Map<string, DerivedTask[]>();
    for (const t of upcoming) {
      const key = t.dueAt.slice(0, 10); // YYYY-MM-DD
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries()); // [[yyyy-mm-dd, tasks], ...] already sorted by tasks[].dueAt
  }, [upcoming]);

  // History — most recent first, filtered by type. The activities query
  // already orders by occurred_at desc, so we just filter.
  const history = React.useMemo(() => {
    return typeFilter === "all"
      ? activities
      : activities.filter((a) => a.type === typeFilter);
  }, [activities, typeFilter]);

  // Per-type counts in a single pass — saves 4 unnecessary array.filter
  // walks on every render.
  const typeCounts = React.useMemo(() => {
    const counts: Record<"all" | ActivityType, number> = {
      all: activities.length,
      call: 0, email: 0, drop_in: 0, appointment: 0,
    };
    for (const a of activities) counts[a.type]++;
    return counts;
  }, [activities]);

  const openLogSheet = (dealId: string) => {
    setLogSheetDealId(dealId);
    setLogSheetOpen(true);
  };

  // Tab counts so the header chips show real numbers.
  const todayCount = overdue.length + today.length;
  const upcomingCount = upcoming.length;
  const historyCount = activities.length;

  return (
    <div className="mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:gap-6">
        {/* Header */}
        <header className="flex flex-col gap-1">
          <h1 className="text-heading-lg text-text-default">Activities</h1>
          <p className="text-body-md text-text-muted">
            {todayCount === 0
              ? "No tasks due today"
              : `${todayCount} ${todayCount === 1 ? "task" : "tasks"} due today`}
            {overdue.length > 0 && (
              <> · <span className="font-medium text-status-danger">{overdue.length} overdue</span></>
            )}
          </p>
        </header>

        <UnloggedCallsSection />

        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <Tabs.List
            className={cn(
              "flex gap-1 overflow-x-auto border-b border-border-subtle",
              "[&::-webkit-scrollbar]:hidden",
              "[-ms-overflow-style:none] [scrollbar-width:none]",
            )}
            aria-label="Activity sections"
          >
            {(["today", "upcoming", "history"] as const).map((key) => {
              const label = key === "today" ? "Today" : key === "upcoming" ? "Upcoming" : "History";
              const count = key === "today" ? todayCount : key === "upcoming" ? upcomingCount : historyCount;
              return (
                <Tabs.Trigger
                  key={key}
                  value={key}
                  className={cn(
                    "relative shrink-0 px-3 py-2 text-body-md font-medium transition-colors",
                    "text-text-muted hover:bg-surface-elevated hover:text-text-default",
                    "data-[state=active]:text-text-default",
                    "data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:h-0.5 data-[state=active]:after:bg-brand-primary",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
                  )}
                >
                  {label}
                  {count > 0 && (
                    <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-radius-full bg-surface-sunken px-1 text-[10px] font-semibold tabular-nums text-text-default">
                      {count}
                    </span>
                  )}
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>

          {/* Today */}
          <Tabs.Content value="today" className="mt-4 focus-visible:outline-none">
            {todayCount === 0 ? (
              <EmptyTodayCard />
            ) : (
              <div className="flex flex-col gap-4">
                {overdue.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <p className="text-eyebrow text-status-danger">Overdue · {overdue.length}</p>
                    <div className="flex flex-col gap-2">
                      {overdue.map((t) => (
                        <TaskRow key={t.fromActivity.id} task={t} now={now} onLog={openLogSheet} />
                      ))}
                    </div>
                  </section>
                )}
                {today.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <p className="text-eyebrow text-text-subtle">Due today · {today.length}</p>
                    <div className="flex flex-col gap-2">
                      {today.map((t) => (
                        <TaskRow key={t.fromActivity.id} task={t} now={now} onLog={openLogSheet} />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </Tabs.Content>

          {/* Upcoming */}
          <Tabs.Content value="upcoming" className="mt-4 focus-visible:outline-none">
            {upcoming.length === 0 ? (
              <EmptyUpcomingCard />
            ) : (
              <div className="flex flex-col gap-4">
                {upcomingByDay.map(([dateKey, items]) => (
                  <section key={dateKey} className="flex flex-col gap-2">
                    <p className="text-eyebrow text-text-subtle">{dayHeading(items[0]!.dueAt, now)}</p>
                    <div className="flex flex-col gap-2">
                      {items.map((t) => (
                        <TaskRow key={t.fromActivity.id} task={t} now={now} onLog={openLogSheet} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </Tabs.Content>

          {/* History */}
          <Tabs.Content value="history" className="mt-4 focus-visible:outline-none">
            <div className="flex flex-col gap-3">
              <div
                className={cn(
                  "flex gap-2 overflow-x-auto pb-1",
                  "[&::-webkit-scrollbar]:hidden",
                  "[-ms-overflow-style:none] [scrollbar-width:none]",
                )}
              >
                {TYPE_FILTERS.map((f) => (
                  <Chip
                    key={f}
                    active={typeFilter === f}
                    count={typeCounts[f]}
                    onClick={() => setTypeFilter(f)}
                  >
                    {typeFilterLabel(f)}
                  </Chip>
                ))}
              </div>

              {history.length === 0 ? (
                activities.length === 0 ? <EmptyHistoryCard /> : (
                  <Card padding="lg" className="flex flex-col items-center gap-2 text-center">
                    <p className="text-body-strong text-text-default">No activities match</p>
                    <p className="text-caption text-text-muted">Try a different type filter.</p>
                  </Card>
                )
              ) : (
                <div className="flex flex-col gap-2">
                  {history.map((a) => (
                    <HistoryRow
                      key={a.id}
                      activity={a}
                      deal={dealById.get(a.dealId)}
                      now={now}
                      onOpenDeal={(id) => navigate(`/pipeline/${id}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>

      {logSheetDealId && (
        <LogActivitySheet
          open={logSheetOpen}
          onOpenChange={setLogSheetOpen}
          dealId={logSheetDealId}
          onLogged={() => {
            // The sheet's own toast already fires. useLogActivity
            // invalidates both ACTIVITIES_ORG_QUERY_KEY and the deals
            // list cache — the tabs refetch automatically.
            toast.success("Activity logged");
          }}
        />
      )}
    </div>
  );
}

export default ActivitiesPage;
