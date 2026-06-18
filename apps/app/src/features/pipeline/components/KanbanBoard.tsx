/**
 * KanbanBoard — desktop-only stage-grouped pipeline view.
 *
 * Five columns (New → Won; Lost is off the active board). Each column header
 * shows the uppercase stage label + "{count} · {$total}", then compact cards
 * (company + value + a stage-colored probability bar), and a "+ Add to {stage}"
 * footer button (when onAddToStage is wired). Cards click through to
 * /pipeline/:id. Drag-and-drop is a later sub-project (it pairs with the
 * FR-PIPE-07 stage-update modal). Mobile never sees this — gated behind lg.
 */
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMoney,
  STAGE_LABEL,
  STAGE_TONE,
  type Deal,
  type DealStage,
} from "../mockData";

const STAGES: DealStage[] = ["new", "contacted", "qualified", "proposal", "won"];

function KanbanCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const pct = Math.max(0, Math.min(100, deal.probability));
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", deal.id)}
      onClick={() => navigate(`/pipeline/${deal.id}`)}
      className={cn(
        "flex w-full flex-col gap-2 rounded-radius-md bg-surface-default p-3 text-left ring-1 ring-border-subtle",
        "transition hover:ring-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
      )}
    >
      <span className="truncate text-body-strong text-text-default">{deal.companyName}</span>
      <span className="text-body-strong tabular-nums text-text-default">{formatMoney(deal.valueCents)}</span>
      <span
        className="h-1.5 w-full overflow-hidden rounded-radius-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Win probability"
      >
        <span className={cn("block h-full rounded-radius-full", STAGE_TONE[deal.stage].barFill)} style={{ width: `${pct}%` }} />
      </span>
    </button>
  );
}

function Column({
  stage, deals, onAddToStage, onDropDeal,
}: {
  stage: DealStage;
  deals: Deal[];
  onAddToStage?: (s: DealStage) => void;
  onDropDeal?: (dealId: string, stage: DealStage) => void;
}) {
  const totalCents = deals.reduce((sum, d) => sum + d.valueCents, 0);
  return (
    <section
      aria-label={`${STAGE_LABEL[stage]} stage`}
      onDragOver={(e) => { if (onDropDeal) e.preventDefault(); }}
      onDrop={(e) => {
        if (!onDropDeal) return;
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropDeal(id, stage);
      }}
      className="flex min-w-0 flex-col gap-3 rounded-radius-md bg-surface-sunken p-3"
    >
      <header className="flex flex-col gap-0.5 px-1">
        <span className="text-caption font-semibold uppercase tracking-wide text-text-muted">
          {STAGE_LABEL[stage]}
        </span>
        <span className="text-caption tabular-nums text-text-muted">
          {deals.length} · {formatMoney(totalCents)}
        </span>
      </header>

      <div className="flex flex-col gap-2">
        {deals.length === 0 ? (
          <p className="px-1 py-6 text-center text-caption text-text-subtle">No deals</p>
        ) : (
          deals.map((d) => <KanbanCard key={d.id} deal={d} />)
        )}
      </div>

      {onAddToStage && (
        <button
          type="button"
          onClick={() => onAddToStage(stage)}
          className="inline-flex items-center justify-center gap-1.5 rounded-radius-md px-2 py-2 text-caption font-medium text-brand-primary hover:bg-surface-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add to {STAGE_LABEL[stage]}
        </button>
      )}
    </section>
  );
}

export function KanbanBoard({
  deals, onAddToStage, onDropDeal,
}: {
  deals: Deal[];
  onAddToStage?: (stage: DealStage) => void;
  onDropDeal?: (dealId: string, stage: DealStage) => void;
}) {
  const byStage: Record<DealStage, Deal[]> = {
    new: [], contacted: [], qualified: [], proposal: [], won: [], lost: [],
  };
  for (const d of deals) byStage[d.stage]?.push(d);

  return (
    <div role="list" className="grid grid-cols-5 gap-3">
      {STAGES.map((s) => (
        <div key={s}>
          <Column stage={s} deals={byStage[s]} onAddToStage={onAddToStage} onDropDeal={onDropDeal} />
        </div>
      ))}
    </div>
  );
}
