/**
 * GetStartedChecklist — the ISO-admin activation checklist (onboarding A1).
 * Purely presentational: it renders the steps it is given and reports intent
 * via callbacks, so the count logic (useOnboardingProgress) stays testable and
 * this stays trivial to unit-test. Renders nothing once every step is done, so
 * the surface retires itself instead of a "skip forever" dismiss.
 */
import { Card, Button } from "@/components/navigatr";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { OnboardingStep } from "../hooks/useOnboardingProgress";

interface Props {
  steps: OnboardingStep[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onStepCta: (to: string) => void;
}

export function GetStartedChecklist({ steps, collapsed, onToggleCollapse, onStepCta }: Props) {
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  // Retire once fully complete — nothing to nudge toward.
  if (doneCount >= total) return null;

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-body-strong text-text-default">Get started</h2>
          <span className="text-caption text-text-muted tabular-nums">
            {doneCount} of {total} done
          </span>
        </div>
        <Button
          type="button"
          variant="tertiary"
          size="sm"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand get-started checklist" : "Collapse get-started checklist"}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronUp className="h-4 w-4" aria-hidden />}
        </Button>
      </header>

      {!collapsed && (
        <ul className="flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span
                  aria-label={s.done ? "Done" : "To do"}
                  className={
                    "flex h-5 w-5 items-center justify-center rounded-radius-full border " +
                    (s.done
                      ? "border-status-success bg-status-success-bg text-status-success"
                      : "border-border-default text-transparent")
                  }
                >
                  {s.done && <Check className="h-3 w-3" aria-hidden />}
                </span>
                <span
                  className={
                    s.done
                      ? "text-body-md text-text-muted line-through"
                      : "text-body-md text-text-default"
                  }
                >
                  {s.label}
                </span>
              </span>

              {!s.done && s.ctaTo && (
                <Button
                  type="button"
                  variant={s.emphasized ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => onStepCta(s.ctaTo!)}
                >
                  {s.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
