/**
 * ChoosePathMode — step 1 of the Plan-a-Path wizard.
 *
 * Two mode cards (FR-PATH-01 / FR-PATH-02):
 *   - Create a Path  → the in-field, current-location discover flow (unchanged).
 *     Selecting Create + Continue navigates out to `/path`.
 *   - Plan a Path    → this wizard's search-by-city flow. Selecting Plan + Continue
 *     advances to the `search` step.
 *
 * Presentational: it owns no navigation. The parent reads `mode` and its footer
 * Continue button routes/advances accordingly; selecting a card calls `onSelect`.
 */
import { Sparkles, MapPinned, Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/navigatr";

export type PathMode = "create" | "plan";

export interface ChoosePathModeProps {
  /** Currently selected mode, or null when nothing is picked yet. */
  mode: PathMode | null;
  onSelect: (mode: PathMode) => void;
}

export function ChoosePathMode({ mode, onSelect }: ChoosePathModeProps) {
  return (
    <div className="flex flex-col gap-4 md:mx-auto md:w-full md:max-w-2xl">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-md text-text-default">How do you want to build your path?</h2>
        <p className="text-body-md text-text-muted">
          Pick one, then continue. You can always start over.
        </p>
      </div>
      <ModeCard
        selected={mode === "create"}
        onClick={() => onSelect("create")}
        icon={Sparkles}
        accent
        eyebrow="In the field · now"
        title="Create a Path"
        body="Auto-discover nearby businesses from your current location and start prospecting right now. Best when you're already in the field."
      />
      <ModeCard
        selected={mode === "plan"}
        onClick={() => onSelect("plan")}
        icon={MapPinned}
        eyebrow="Prep ahead"
        title="Plan a Path"
        body="Search by city or ZIP, filter by business type, and hand-pick the stops you want to visit. Best for prepping an upcoming day."
      />
    </div>
  );
}

function ModeCard({
  selected, onClick, icon: Icon, accent = false, eyebrow, title, body,
}: {
  selected: boolean;
  onClick: () => void;
  icon: LucideIcon;
  accent?: boolean;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="group text-left focus-visible:outline-none"
    >
      <Card
        padding="lg"
        className={cn(
          "flex items-start gap-4 transition-colors",
          selected
            ? "border-brand ring-2 ring-brand-primary ring-offset-2 ring-offset-surface-canvas"
            : accent
              ? "hover:border-brand"
              : "hover:border-border-strong",
        )}
      >
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-md",
            accent ? "bg-brand-10 text-brand" : "bg-surface-sunken text-text-muted",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-caption font-medium uppercase tracking-wide text-text-subtle">{eyebrow}</span>
          <p className="text-heading-sm text-text-default">{title}</p>
          <p className="text-body-md text-text-muted">{body}</p>
        </div>
        {selected && (
          <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary text-brand-primary-foreground">
            <Check className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </Card>
    </button>
  );
}

export default ChoosePathMode;
