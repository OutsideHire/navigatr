import { Sparkles, MapPinned, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/navigatr";

interface PathEntryProps {
  onCreate: () => void;
  onPlan: () => void;
}

/**
 * PathEntry — first thing a rep sees with no active path: pick how to build one.
 * Create (the in-field, now action) is the primary, brand-coded option; Plan
 * (prep-ahead) is the calmer secondary. Each is one large tappable row.
 */
export function PathEntry({ onCreate, onPlan }: PathEntryProps) {
  return (
    <div className="mt-6 flex flex-col gap-4 self-stretch md:mx-auto md:w-full md:max-w-2xl">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-md text-text-default">Start a path</h2>
        <p className="text-body-md text-text-muted">How do you want to build today&apos;s route?</p>
      </div>
      <EntryOption
        onClick={onCreate}
        icon={Sparkles}
        accent
        eyebrow="In the field · now"
        title="Create a Path"
        body="Auto-discover nearby businesses from your current location and start prospecting right now. Best when you're already in the field."
      />
      <EntryOption
        onClick={onPlan}
        icon={MapPinned}
        eyebrow="Prep ahead"
        title="Plan a Path"
        body="Search by city or ZIP, filter by business type, and hand-pick the stops you want to visit later. Best for prepping an upcoming day."
      />
    </div>
  );
}

function EntryOption({
  onClick, icon: Icon, accent = false, eyebrow, title, body,
}: {
  onClick: () => void;
  icon: LucideIcon;
  accent?: boolean;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <Card
        padding="lg"
        className={cn(
          "flex items-start gap-4 transition-colors",
          accent ? "hover:border-brand" : "hover:border-border-strong",
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
        <ChevronRight
          className="mt-1 h-5 w-5 shrink-0 text-text-subtle transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Card>
    </button>
  );
}
