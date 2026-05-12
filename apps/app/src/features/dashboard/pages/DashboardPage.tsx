/**
 * Dashboard — first-time-user empty state.
 *
 * Source: Figma `06a · First dashboard (mobile)` 148:358 and
 * `06b · First dashboard (desktop)` 148:464 (the playbook's quoted ID
 * 234:600 was just a "View all →" text snippet — these are the real
 * artboards).
 *
 * Specs (mobile):
 *   - Content: 360 × 660 · VERTICAL · gap 24 · padding 16/16/16/16
 *   - Heading: heading/lg "Welcome, {firstName}" + body/md text/muted
 *              "Let's get you set up. Four steps to get the most out of navigatr."
 *   - Cards: 4 cards, VERTICAL stack, gap 12.
 *     Each: 328 × 92 · HORIZONTAL · gap 16 · padding 16 · surface/default
 *     fill · radius 10 · icon container 48 × 48 radius/md with
 *     accent/{teal,violet,orange,blue}-20 fill · ChevronRight trailing.
 *
 * Specs (desktop):
 *   - Same content, 2 × 2 card grid (gap 16) inside a max-width container.
 *
 * Data strategy: Option B from the playbook. Always render the empty state
 * for now. When the backend ships (Session 12+), check `/api/me` +
 * `/api/deals?limit=0` + `/api/activities?limit=0` + `/api/partners?limit=0`
 * — if any count > 0 or `hasDismissedOnboarding(user) === true`, render the
 * real Rep Dashboard instead.
 *
 * Role gating: "Invite your team" only appears for admin/cso/svp/vp/director/
 * territory_manager. Sales Professional doesn't see it. Self-signup users
 * with no role set default to admin (they own their tenant).
 */

import { ChevronRight, Compass, CheckCircle2, Handshake, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card } from "@/components/navigatr";
import {
  canInviteTeam,
  getFirstName,
  hasDismissedOnboarding,
  useAuth,
} from "@/stores/auth";
import { cn } from "@/lib/utils";

interface SetupCard {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon container (alpha-baked accent bg + fg). */
  accent: { bg: string; fg: string };
  /** Route to navigate on click. */
  to: string;
  /** Only render for users with `canInviteTeam(user) === true`. */
  requiresInvitePermission?: boolean;
}

const SETUP_CARDS: SetupCard[] = [
  {
    key: "partner",
    title: "Add your first partner",
    description: "A CPA, banker, or referral source you trust.",
    icon: Handshake,
    accent: { bg: "bg-accent-teal-20", fg: "text-accent-teal" },
    to: "/partners?action=add",
  },
  {
    key: "path",
    title: "Run your first Path",
    description: "Discover prospects in your area.",
    icon: Compass,
    accent: { bg: "bg-accent-violet-20", fg: "text-accent-violet" },
    to: "/path",
  },
  {
    key: "activity",
    title: "Log your first activity",
    description: "Email, call, drop-in, or appointment.",
    icon: CheckCircle2,
    accent: { bg: "bg-accent-orange-20", fg: "text-accent-orange" },
    to: "/activities?action=log",
  },
  {
    key: "team",
    title: "Invite your team",
    description: "Bring your reps and managers on board.",
    icon: Users,
    accent: { bg: "bg-accent-blue-20", fg: "text-accent-blue" },
    to: "/settings/users",
    requiresInvitePermission: true,
  },
];

export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const dismissOnboarding = useAuth((s) => s.dismissOnboarding);
  const navigate = useNavigate();

  const firstName = getFirstName(user);
  const showInvite = canInviteTeam(user);
  const cards = SETUP_CARDS.filter((c) => !c.requiresInvitePermission || showInvite);

  // ──────────────────────────────────────────────────────────────────────
  // Real Rep Dashboard lands in Session 12. Once the API endpoints exist,
  // this page should branch: if the user has data OR has dismissed the
  // onboarding, render the data-rich dashboard. For now, ALWAYS show
  // the empty state — except we still respect the dismiss flag so once a
  // user dismisses, they don't see this screen again (instead they see a
  // small placeholder until Session 12).
  // ──────────────────────────────────────────────────────────────────────

  if (hasDismissedOnboarding(user)) {
    return <DismissedPlaceholder firstName={firstName} />;
  }

  const handleSkip = async () => {
    try {
      await dismissOnboarding();
      toast.success("Setup skipped. You can run these steps later from Settings.");
      // Same route — the dismissed-state placeholder will render instead.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save preference");
    }
  };

  return (
    // Outer container — Figma mobile uses 16 px page padding, desktop is wider.
    // We use the standard content-area pattern: max-width container + responsive
    // padding. AppLayout's main already handles the chrome.
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* Heading */}
      <header className="flex flex-col gap-2">
        <h1 className="text-heading-lg text-text-default">
          Welcome, {firstName}
        </h1>
        <p className="text-body-md text-text-muted">
          Let&apos;s get you set up. {cards.length} {cards.length === 1 ? "step" : "steps"} to get
          the most out of navigatr.
        </p>
      </header>

      {/* Cards — VERTICAL on mobile, 2-col grid on md+ */}
      <div
        className={cn(
          "mt-6 grid gap-3",
          "grid-cols-1",
          // 2 cols at md+ when we have at least 2 cards
          cards.length >= 2 && "md:grid-cols-2 md:gap-4",
        )}
      >
        {cards.map((card) => (
          <SetupCardItem key={card.key} card={card} onNavigate={(to) => navigate(to)} />
        ))}
      </div>

      {/* Skip secondary action */}
      <div className="mt-6 flex justify-center">
        <Button
          variant="tertiary"
          size="md"
          onClick={handleSkip}
        >
          Skip the setup and explore
        </Button>
      </div>
    </div>
  );
}

// ─── Single setup card ──────────────────────────────────────────────────

function SetupCardItem({
  card,
  onNavigate,
}: {
  card: SetupCard;
  onNavigate: (to: string) => void;
}) {
  const Icon = card.icon;
  return (
    <Card
      // padding=none because the card is composed in-flow (HORIZONTAL layout
      // with internal padding via flex container below) — matches Figma's
      // 92 × 328 dim with 16 px internal padding.
      padding="md"
      shadow="sm"
      onClick={() => onNavigate(card.to)}
      // Keep the focus ring + interactive cursor from Card's `interactive`
      // variant — onClick triggers it automatically.
    >
      <div className="flex items-center gap-4">
        <span
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-radius-md",
            card.accent.bg,
            card.accent.fg,
          )}
          aria-hidden
        >
          <Icon className="h-6 w-6" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body-strong text-text-default">{card.title}</span>
          <span className="text-caption text-text-muted">{card.description}</span>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-text-subtle" aria-hidden />
      </div>
    </Card>
  );
}

// ─── Post-dismiss placeholder ───────────────────────────────────────────

function DismissedPlaceholder({ firstName }: { firstName: string }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="flex flex-col gap-2">
        <p className="text-eyebrow text-text-subtle">Dashboard</p>
        <h1 className="text-heading-lg text-text-default">
          Welcome back, {firstName}
        </h1>
        <p className="text-body-md text-text-muted">
          The Rep / Manager / Executive dashboards land in Session 12. Today's Tasks, KPI row,
          recent activity, and alerts will all render here.
        </p>
      </header>

      <Card padding="xl" shadow="sm" className="mt-6">
        <p className="text-eyebrow text-text-subtle">Coming in Session 12</p>
        <h2 className="mt-1 text-heading-md text-text-default">Rep Dashboard.</h2>
        <p className="mt-3 max-w-2xl text-body-md text-text-muted">
          Activities-to-Win marquee, pipeline + win rate + weighted forecast KPIs, Today&apos;s
          Tasks, recent activity, and partner-sourced alerts.
        </p>
      </Card>
    </div>
  );
}

export default DashboardPage;
