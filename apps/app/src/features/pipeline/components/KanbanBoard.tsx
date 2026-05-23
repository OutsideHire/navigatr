/**
 * KanbanBoard — desktop-only stage-grouped view of the pipeline.
 *
 * Five columns matching the canonical deal stages. Each column shows the
 * stage label, deal count, and weighted sum at the top, then a compact
 * vertical list of deals using `CardWithStatusBand`'s existing color
 * grammar. Cards reuse the deal-card click-through (route to
 * `/pipeline/:dealId`) so nothing new lives here for navigation.
 *
 * In kanban view the stage chip filter is irrelevant (the columns ARE
 * the stages). Search still applies — a filtered search collapses to
 * matching cards within each column.
 *
 * Mobile users never see this — the parent gates it behind the lg
 * breakpoint. Kanban needs horizontal real estate.
 */

import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  formatMoney,
  formatRelative,
  STAGE_LABEL,
  type Deal,
  type DealStage,
} from "../mockData";

const STAGES: DealStage[] = ["new", "contacted", "qualified", "proposal", "won", "lost"];

// Map the stage band's semantic color name to the tailwind class for the
// 8px dot in the column header. Kept here (not in mockData) because the
// dot is a kanban-specific affordance.
const STAGE_DOT_CLASS: Record<DealStage, string> = {
  new:        "bg-status-info",
  contacted:  "bg-status-warning",
  qualified:  "bg-accent-teal",
  proposal:   "bg-accent-violet",
  won:        "bg-status-success",
  lost:       "bg-status-danger",
};

function KanbanCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/pipeline/${deal.id}`)}
      className={cn(
        "group flex w-full items-stretch overflow-hidden rounded-radius-md",
        "bg-surface-default text-left ring-1 ring-border-subtle",
        "transition hover:ring-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
      )}
    >
      {/* Stage color band — same grammar as the list-view DealCard. */}
      <span
        aria-hidden
        className={cn("w-1 shrink-0", STAGE_DOT_CLASS[deal.stage])}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-body-strong text-text-default">
            {deal.companyName}
          </span>
          <span className="shrink-0 text-body-strong tabular-nums text-text-default">
            {formatMoney(deal.valueCents)}
          </span>
        </span>
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-caption text-text-muted">
            {deal.contactName}
          </span>
          <span className="shrink-0 text-caption tabular-nums text-text-subtle">
            {formatRelative(deal.lastActivity)}
          </span>
        </span>
      </span>
    </button>
  );
}

function Column({ stage, deals }: { stage: DealStage; deals: Deal[] }) {
  const totalCents = deals.reduce((sum, d) => sum + d.valueCents, 0);
  return (
    <section
      aria-label={`${STAGE_LABEL[stage]} stage`}
      className="flex min-w-0 flex-col gap-3 rounded-radius-md bg-surface-sunken p-3"
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className={cn("h-2 w-2 rounded-radius-full", STAGE_DOT_CLASS[stage])}
          />
          <span className="text-body-strong text-text-default">
            {STAGE_LABEL[stage]}
          </span>
          <span
            className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-radius-full bg-surface-default px-1.5 text-[11px] font-medium tabular-nums text-text-muted"
            aria-label={`${deals.length} deals`}
          >
            {deals.length}
          </span>
        </span>
        <span className="text-caption tabular-nums text-text-muted">
          {formatMoney(totalCents)}
        </span>
      </header>

      <div className="flex flex-col gap-2">
        {deals.length === 0 ? (
          <p className="px-1 py-6 text-center text-caption text-text-subtle">
            No deals
          </p>
        ) : (
          deals.map((d) => <KanbanCard key={d.id} deal={d} />)
        )}
      </div>
    </section>
  );
}

export function KanbanBoard({ deals }: { deals: Deal[] }) {
  // Bucket by stage. One pass.
  const byStage: Record<DealStage, Deal[]> = {
    new: [], contacted: [], qualified: [], proposal: [], won: [], lost: [],
  };
  for (const d of deals) byStage[d.stage].push(d);

  return (
    <div
      role="list"
      className="grid grid-cols-6 gap-3"
      // Six-column kanban: new/contacted/qualified/proposal/won/lost.
      // Below lg breakpoint the parent renders the list view instead.
    >
      {STAGES.map((s) => (
        <div key={s} className={cn(s === "lost" && "opacity-75")}>
          <Column stage={s} deals={byStage[s]} />
        </div>
      ))}
    </div>
  );
}

