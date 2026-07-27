/**
 * KanbanBoard — desktop-only stage-grouped pipeline view.
 *
 * Drag-and-drop via @dnd-kit (pointer + keyboard sensors). Dropping a card on a
 * different column calls onDropDeal(dealId, stage); PipelinePage opens the
 * StageUpdateModal. Cards stay clickable (8px activation distance distinguishes a
 * click from a drag). Lost is off the board. Mobile never sees this (lg-gated).
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor,
  useSensor, useSensors, useDraggable, useDroppable,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { resolveDrop } from "../lib/resolveDrop";
import {
  formatMoney, STAGE_LABEL, STAGE_TONE, type Deal, type DealStage,
} from "../mockData";

const STAGES: DealStage[] = ["new", "contacted", "qualified", "proposal", "submitted", "won"];

/** Visual contents of a card — shared by the live card and the drag overlay. */
function CardBody({ deal }: { deal: Deal }) {
  const pct = Math.max(0, Math.min(100, deal.probability));
  return (
    <>
      <span className="truncate text-body-strong text-text-default">{deal.companyName}</span>
      <span className="text-body-strong tabular-nums text-text-default">{formatMoney(deal.valueCents)}</span>
      <span
        className="h-1.5 w-full overflow-hidden rounded-radius-full bg-surface-sunken"
        role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Win probability"
      >
        <span className={cn("block h-full rounded-radius-full", STAGE_TONE[deal.stage].barFill)} style={{ width: `${pct}%` }} />
      </span>
    </>
  );
}

const CARD_CLASS =
  "flex w-full cursor-grab flex-col gap-2 rounded-radius-md bg-surface-default p-3 text-left ring-1 ring-border-subtle transition hover:ring-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary";

function KanbanCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { stage: deal.stage },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => navigate(`/pipeline/${deal.id}`)}
      style={isDragging ? { opacity: 0.4 } : undefined}
      className={CARD_CLASS}
    >
      <CardBody deal={deal} />
    </div>
  );
}

function Column({
  stage, deals, onAddToStage,
}: { stage: DealStage; deals: Deal[]; onAddToStage?: (s: DealStage) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const totalCents = deals.reduce((sum, d) => sum + d.valueCents, 0);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STAGE_LABEL[stage]} stage`}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-radius-md bg-surface-sunken p-3 transition",
        isOver && "ring-2 ring-brand-primary ring-offset-2 ring-offset-surface-canvas",
      )}
    >
      <header className="flex flex-col gap-0.5 px-1">
        <span className="text-caption font-semibold uppercase tracking-wide text-text-muted">{STAGE_LABEL[stage]}</span>
        <span className="text-caption tabular-nums text-text-muted">{deals.length} · {formatMoney(totalCents)}</span>
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const byStage: Record<DealStage, Deal[]> = {
    new: [], contacted: [], qualified: [], proposal: [], submitted: [], won: [], lost: [],
  };
  for (const d of deals) byStage[d.stage]?.push(d);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const activeDeal = activeId ? deals.find((d) => d.id === activeId) ?? null : null;

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const fromStage = e.active.data.current?.stage as DealStage | undefined;
    const overStage = (e.over?.id as DealStage | undefined) ?? null;
    const dest = resolveDrop(fromStage, overStage);
    if (dest) onDropDeal?.(String(e.active.id), dest);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div role="list" className="grid grid-cols-6 gap-3">
        {STAGES.map((s) => (
          <div key={s}>
            <Column stage={s} deals={byStage[s]} onAddToStage={onAddToStage} />
          </div>
        ))}
      </div>
      <DragOverlay>
        {activeDeal ? (
          <div className={cn(CARD_CLASS, "cursor-grabbing shadow-card-hover")}>
            <CardBody deal={activeDeal} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
