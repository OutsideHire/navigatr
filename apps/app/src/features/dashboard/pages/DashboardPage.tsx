/**
 * Dashboard — Rep View (populated state) + first-time-user empty state.
 *
 * Source for populated state:
 *   - Figma `mobile · Merchant Services`  234:525 (360 × 3164)
 *   - Figma `desktop · Merchant Services` 238:4   (1280 × 1910)
 *
 * Source for empty state (Session 11):
 *   - Figma `06a · First dashboard (mobile)` 148:358
 *   - Figma `06b · First dashboard (desktop)` 148:464
 *
 * Branching:
 *   - Sprint 1: hardcoded to render the populated state from mockData.ts
 *     UNLESS the user has explicitly tapped "Skip the setup" yet has no
 *     real data (no API yet). The empty state from Session 11 is rendered
 *     when `hasDismissedOnboarding(user) === false`, matching the
 *     first-time-user flow.
 *   - Sprint 2 TODO: wire TanStack Query hooks that count deals /
 *     partners / activities; render empty when all === 0 AND not
 *     dismissed; populated otherwise.
 *
 * Gradient discipline (DESIGN.md):
 *   The Activities-to-Win hero KpiCard is the ONLY gradient surface in
 *   the entire app. Every other KpiCard on this page uses
 *   accent-colored icon containers, no gradient.
 */

import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Clock,
  Clock4,
  Compass,
  DollarSign,
  Filter as FilterIcon,
  Handshake,
  MapPin,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Avatar,
  Badge,
  Button,
  Card,
  KpiCard,
  ListRow,
} from "@/components/navigatr";
import {
  canInviteTeam,
  getFirstName,
  hasDismissedOnboarding,
  useAuth,
} from "@/stores/auth";
import { cn } from "@/lib/utils";
import { MOCK, formatMoney } from "../mockData";

// ───────────────────────────────────────────────────────────────────────
// Empty state — copied from Session 11. Lives here so the page picks
// either populated or empty in one component.
// ───────────────────────────────────────────────────────────────────────

interface SetupCard {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: { bg: string; fg: string };
  to: string;
  requiresInvitePermission?: boolean;
}

const SETUP_CARDS: SetupCard[] = [
  { key: "partner",  title: "Add your first partner",   description: "A CPA, banker, or referral source you trust.",     icon: Handshake,     accent: { bg: "bg-accent-teal-20",   fg: "text-accent-teal"   }, to: "/partners?action=add" },
  { key: "path",     title: "Run your first Path",      description: "Discover prospects in your area.",                  icon: Compass,       accent: { bg: "bg-accent-violet-20", fg: "text-accent-violet" }, to: "/path" },
  { key: "activity", title: "Log your first activity",  description: "Email, call, drop-in, or appointment.",             icon: CheckCircle2,  accent: { bg: "bg-accent-orange-20", fg: "text-accent-orange" }, to: "/activities?action=log" },
  { key: "team",     title: "Invite your team",         description: "Bring your reps and managers on board.",            icon: Users,         accent: { bg: "bg-accent-blue-20",   fg: "text-accent-blue"   }, to: "/settings/users", requiresInvitePermission: true },
];

function EmptyDashboard({ firstName, onSkip }: { firstName: string; onSkip: () => void }) {
  const user = useAuth((s) => s.user);
  const showInvite = canInviteTeam(user);
  const cards = SETUP_CARDS.filter((c) => !c.requiresInvitePermission || showInvite);
  const navigate = useNavigate();
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-heading-lg text-text-default">Welcome, {firstName}</h1>
        <p className="text-body-md text-text-muted">
          Let&apos;s get you set up. {cards.length} {cards.length === 1 ? "step" : "steps"} to get the
          most out of navigatr.
        </p>
      </header>
      <div className={cn("mt-6 grid gap-3 grid-cols-1", cards.length >= 2 && "md:grid-cols-2 md:gap-4")}>
        {cards.map((card) => (
          <Card key={card.key} padding="md" shadow="sm" onClick={() => navigate(card.to)}>
            <div className="flex items-center gap-4">
              <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-radius-md", card.accent.bg, card.accent.fg)} aria-hidden>
                <card.icon className="h-6 w-6" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-body-strong text-text-default">{card.title}</span>
                <span className="text-caption text-text-muted">{card.description}</span>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-text-subtle" aria-hidden />
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-6 flex justify-center">
        <Button variant="tertiary" size="md" onClick={onSkip}>Skip the setup and explore</Button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Populated dashboard sections
// ───────────────────────────────────────────────────────────────────────

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-heading-sm text-text-default">{title}</h2>
      {action}
    </div>
  );
}

// Section 2: Page heading — matches Figma 234:541 / 238:23: heading-lg
// "Dashboard" + body-md "Card processing pipeline · Wed Apr 30" + (desktop)
// Last-30-days / Filter tertiary buttons right-aligned.
function PageHeading({ firstName: _firstName }: { firstName: string }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-default">Dashboard</h1>
        <p className="text-body-md text-text-muted">
          Card processing pipeline · {MOCK.date.display}
        </p>
      </div>
      <div className="hidden gap-2 sm:flex">
        <Button
          variant="tertiary"
          size="sm"
          leadingIcon={Clock4}
          onClick={() => toast("Custom date ranges land in Sprint 2")}
        >
          Last 30 days
        </Button>
        <Button
          variant="tertiary"
          size="sm"
          leadingIcon={FilterIcon}
          onClick={() => toast("Dashboard filters land in Sprint 2")}
        >
          Filter
        </Button>
      </div>
    </header>
  );
}

// Section 3: Activities-to-Win hero KPI — the ONE gradient surface.
//
// Bespoke layout (not KpiCard) because the hero stretches full-width on
// desktop and a single-column flex left the right half of the gradient
// visually empty. Two-column on md+: content left, oversized ghost-Zap
// glyph right to anchor the gradient. Mobile keeps a single column with
// a smaller corner glyph so the value stays the focal point.
function ActivitiesToWinHero() {
  const k = MOCK.activitiesToWin;
  const TrendIcon = k.trend.direction === "down" ? TrendingDown : TrendingUp;
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          "relative overflow-hidden rounded-radius-md p-6 sm:p-8",
          "bg-gradient-to-br from-brand-gradient-from via-brand-gradient-via to-brand-gradient-to",
          "text-text-inverse",
        )}
      >
        {/* Decorative ghost-glyph anchoring the right side of the gradient.
            Positioned to bleed into the bottom-right corner. aria-hidden;
            pure decoration. */}
        <Zap
          aria-hidden
          className={cn(
            "pointer-events-none absolute text-text-inverse/10",
            // Mobile: smaller, top-right corner. Desktop: huge, centered-right.
            "right-[-24px] top-[-16px] h-40 w-40 rotate-12",
            "sm:right-[-32px] sm:top-1/2 sm:h-64 sm:w-64 sm:-translate-y-1/2 sm:rotate-0",
            "lg:right-[-24px] lg:h-72 lg:w-72",
          )}
          strokeWidth={1.25}
        />

        <div className="relative flex flex-col gap-3 sm:max-w-[60%]">
          {/* Eyebrow row */}
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-full bg-text-inverse/15">
              <Zap className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-eyebrow text-text-inverse/80">ACTIVITIES TO WIN</span>
          </div>

          {/* Value */}
          <p className="text-kpi-lg tabular-nums leading-none text-text-inverse">
            {k.value}
          </p>

          {/* Subtitle + trend */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            <span className="text-caption text-text-inverse/80">{k.subtitle}</span>
            <span className="inline-flex items-center gap-1 rounded-radius-full bg-text-inverse/15 px-2 py-0.5 text-caption font-medium tabular-nums text-text-inverse">
              <TrendIcon className="h-3 w-3" aria-hidden />
              {k.trend.label}
            </span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          variant="tertiary"
          size="sm"
          trailingIcon={ArrowRight}
          onClick={() => toast("Persistence index lands in a later session")}
        >
          View persistence index
        </Button>
      </div>
    </div>
  );
}

// Section 4: Secondary KPI row (4 cards)
const KPI_ICONS: Record<string, LucideIcon> = {
  leads: Users,
  pipeline: DollarSign,
  win: TrendingUp,
  close: Clock,
};

function SecondaryKpiRow() {
  return (
    <div
      // Mobile: horizontal scroll with snap. Desktop: 4-col grid.
      className={cn(
        "flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory",
        "md:grid md:grid-cols-4 md:gap-4 md:overflow-x-visible md:snap-none md:pb-0",
        "[&::-webkit-scrollbar]:hidden",
        "[-ms-overflow-style:none] [scrollbar-width:none]",
      )}
    >
      {MOCK.kpis.map((kpi) => (
        <div key={kpi.key} className="min-w-[220px] shrink-0 snap-start md:min-w-0">
          <KpiCard
            eyebrow={kpi.eyebrow}
            value={kpi.value}
            subtitle={kpi.subtitle}
            trend={kpi.trend}
            icon={KPI_ICONS[kpi.key] ?? Briefcase}
            accent={kpi.accent}
            size="standard"
          />
        </div>
      ))}
    </div>
  );
}

// Section 5: Pipeline by Stage
function PipelineByStage() {
  return (
    <Card padding="lg" shadow="sm">
      <SectionHeader
        title="Pipeline by stage"
        action={
          <Button variant="tertiary" size="sm" trailingIcon={ArrowRight} onClick={() => toast("Pipeline lands in Session 13")}>
            View all
          </Button>
        }
      />
      <div className="flex flex-col gap-3">
        {MOCK.pipelineByStage.map((stage) => (
          <div key={stage.label} className="flex items-center gap-3">
            <Badge kind={stage.stage} className="min-w-[80px] justify-center">{stage.label}</Badge>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-caption text-text-muted">
                  {stage.count} {stage.count === 1 ? "deal" : "deals"} · <span className="tabular-nums text-text-default">{formatMoney(stage.valueCents)}</span>
                </span>
                <span className="text-caption tabular-nums text-text-subtle">{stage.percentOfPipeline}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-radius-full bg-surface-sunken">
                <div
                  className="h-full rounded-radius-full bg-brand-primary"
                  style={{ width: `${stage.percentOfPipeline}%` }}
                  aria-hidden
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Section 6: Today's Snapshot
const SNAPSHOT_ICONS = {
  alert: AlertCircle,
  map: MapPin,
  clock: Clock,
};
const SNAPSHOT_ACCENTS: Record<string, { bg: string; fg: string }> = {
  warning: { bg: "bg-status-warning-bg", fg: "text-status-warning" },
  violet:  { bg: "bg-accent-violet-20",  fg: "text-accent-violet"  },
  danger:  { bg: "bg-status-danger-bg",  fg: "text-status-danger"  },
};
function TodaysSnapshot() {
  const navigate = useNavigate();
  return (
    <Card padding="none" shadow="sm">
      <div className="px-6 pt-5">
        <h2 className="text-heading-sm text-text-default">Today&apos;s snapshot</h2>
      </div>
      <div className="mt-2 flex flex-col">
        {MOCK.todaysSnapshot.map((row, i) => {
          const Icon = SNAPSHOT_ICONS[row.iconKind];
          const accent = SNAPSHOT_ACCENTS[row.iconAccent]!;
          return (
            <ListRow
              key={row.key}
              divider={i < MOCK.todaysSnapshot.length - 1}
              onClick={() => navigate(row.to)}
              leading={
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-radius-md", accent.bg, accent.fg)}>
                  <Icon className="h-4 w-4" />
                </span>
              }
              title={row.title}
              subtitle={row.subtitle}
              trailing={<ChevronRight className="h-5 w-5 text-text-subtle" />}
            />
          );
        })}
      </div>
    </Card>
  );
}

// Section 7: Monthly Performance — simple bar chart in pure CSS
function MonthlyPerformance() {
  const maxValue = Math.max(...MOCK.monthlyPerformance.map((m) => m.valueCents));
  return (
    <Card padding="lg" shadow="sm">
      <SectionHeader
        title="Monthly performance"
        action={
          <Button variant="tertiary" size="sm" leadingIcon={Clock4}>Last 4 months</Button>
        }
      />
      {/* Bar chart: outer is a flex row of 4 columns. Each column is its own
          flex-col stretched to full height — `items-stretch` on the outer
          (default) lets each column own its height. The bar div takes a
          percentage of its parent's height; without this stretch the
          percentages resolved to 0 and bars went invisible. */}
      <div className="flex h-44 items-stretch gap-4">
        {MOCK.monthlyPerformance.map((m) => {
          const heightPct = (m.valueCents / maxValue) * 100;
          return (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
              {/* Bar wrapper — fills column height; bar grows from the bottom. */}
              <div className="relative w-full flex-1">
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t-radius-sm bg-brand-primary transition-all"
                  style={{ height: `${heightPct}%` }}
                  aria-label={`${m.month}: ${m.deals} deals · ${formatMoney(m.valueCents)}`}
                />
              </div>
              <div className="flex flex-col items-center">
                <span className="text-caption text-text-muted">{m.month}</span>
                <span className="text-caption font-medium tabular-nums text-text-default">
                  {m.deals} {m.deals === 1 ? "deal" : "deals"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// Section 8: Persistence index (3 mini-stats)
function PersistenceIndex() {
  return (
    <Card padding="lg" shadow="sm">
      <SectionHeader title="Persistence index" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {MOCK.persistenceIndex.map((stat) => (
          <div key={stat.eyebrow} className="flex flex-col gap-1 rounded-radius-md bg-surface-sunken p-4">
            <span className="text-eyebrow text-text-subtle">{stat.eyebrow}</span>
            <span className="text-kpi-md tabular-nums text-text-default">{stat.value}</span>
            <span className="text-caption text-text-muted">{stat.caption}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Section 9: Top Partners leaderboard
function TopPartners() {
  return (
    <Card padding="none" shadow="sm">
      <div className="flex items-center justify-between gap-3 px-6 pt-5">
        <h2 className="text-heading-sm text-text-default">Top partners this quarter</h2>
        <Button variant="tertiary" size="sm" trailingIcon={ArrowRight} onClick={() => toast("Partners lands in Session 14")}>
          View all
        </Button>
      </div>
      <div className="mt-2 flex flex-col">
        {MOCK.topPartners.map((p, i) => (
          <ListRow
            key={p.name}
            divider={i < MOCK.topPartners.length - 1}
            leading={
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-radius-full bg-surface-sunken text-caption font-semibold text-text-default">
                  {p.rank}
                </span>
                <Avatar alt={p.name} size="sm" />
              </div>
            }
            title={p.name}
            subtitle={`${p.referrals} referrals · ${formatMoney(p.revenueCents)}`}
            trailing={
              <span className="text-body-strong tabular-nums text-text-default">
                {formatMoney(p.revenueCents)}
              </span>
            }
          />
        ))}
      </div>
    </Card>
  );
}

// Section 10: Lead Sources (single horizontal stacked bar + legend)
function LeadSources() {
  const segmentColors: Record<string, string> = {
    teal:   "bg-accent-teal",
    violet: "bg-accent-violet",
    blue:   "bg-accent-blue",
    orange: "bg-accent-orange",
  };
  const dotColors: Record<string, string> = {
    teal:   "bg-accent-teal",
    violet: "bg-accent-violet",
    blue:   "bg-accent-blue",
    orange: "bg-accent-orange",
  };
  return (
    <Card padding="lg" shadow="sm">
      <SectionHeader title="Lead sources this quarter" />
      {/* Stacked bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-radius-full bg-surface-sunken">
        {MOCK.leadSources.map((seg) => (
          <div
            key={seg.label}
            className={cn("h-full", segmentColors[seg.accent])}
            style={{ width: `${seg.percent}%` }}
            aria-label={`${seg.label}: ${seg.percent}%`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {MOCK.leadSources.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-radius-full", dotColors[seg.accent])} aria-hidden />
            <span className="text-body-sm text-text-default">{seg.label}</span>
            <span className="ml-auto text-body-sm tabular-nums text-text-muted">{seg.percent}%</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Section 11: Conversion Funnel
function ConversionFunnel() {
  return (
    <Card padding="lg" shadow="sm">
      <SectionHeader title="Conversion funnel" />
      <div className="flex flex-col gap-4">
        {MOCK.conversionFunnel.map((step) => (
          <div key={`${step.from}-${step.to}`} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-body-md text-text-default">
                {step.from} <ArrowRight className="inline h-3 w-3 text-text-subtle" aria-hidden /> {step.to}
              </span>
              <span className="text-body-strong tabular-nums text-text-default">
                {step.rate}%
                <span className="ml-2 text-caption font-normal text-text-muted">
                  ({step.fromCount} → {step.toCount})
                </span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-radius-full bg-surface-sunken">
              <div
                className={cn(
                  "h-full rounded-radius-full",
                  step.rate >= 70 ? "bg-status-success" : step.rate >= 50 ? "bg-accent-teal" : "bg-status-warning",
                )}
                style={{ width: `${step.rate}%` }}
                aria-hidden
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Populated Dashboard composer
// ───────────────────────────────────────────────────────────────────────

function PopulatedDashboard({ firstName: _firstName }: { firstName: string }) {
  return (
    // Mobile: vertical stack, gap 12 (matches Figma 234:541 gap 16 ≈ space-3/4).
    // Desktop: heading + hero + KPI row are full-width, sections 5-11 fall
    // into a 2-column grid with the Conversion Funnel spanning both cols.
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <PageHeading firstName={_firstName} />

      <div className="mt-6 flex flex-col gap-4 lg:gap-6">
        {/* Hero */}
        <ActivitiesToWinHero />

        {/* Secondary KPI row */}
        <SecondaryKpiRow />

        {/* 2-col grid for sections 5-11 */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <PipelineByStage />
          <TodaysSnapshot />
          <MonthlyPerformance />
          <PersistenceIndex />
          <TopPartners />
          <LeadSources />
          {/* Conversion funnel spans both columns on desktop */}
          <div className="lg:col-span-2">
            <ConversionFunnel />
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Top-level page — picks empty vs populated
// ───────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const dismissOnboarding = useAuth((s) => s.dismissOnboarding);
  const firstName = getFirstName(user);

  // Branching:
  //   - Empty state: render Session-11 setup-cards screen until user
  //     dismisses onboarding.
  //   - Populated state: this page from mockData.ts.
  //
  // Sprint 2 TODO: replace `hasDismissedOnboarding` gate with a real
  // count check via TanStack Query — if user has 0 deals + 0 partners +
  // 0 activities AND not dismissed → empty, else populated.
  const dismissed = hasDismissedOnboarding(user);

  if (!dismissed) {
    return (
      <EmptyDashboard
        firstName={firstName}
        onSkip={async () => {
          try {
            await dismissOnboarding();
            toast.success("Welcome to the dashboard.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't save preference");
          }
        }}
      />
    );
  }

  return <PopulatedDashboard firstName={firstName} />;
}

export default DashboardPage;
