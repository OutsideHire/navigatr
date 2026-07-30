/**
 * PersistenceIndexWidget — beta Persistence Index. Reps see their own score
 * (Slice 1); managers/admins see the team-aggregate median (Slice 2). Same
 * layout, role-framed labels. Component rows render from the result's
 * `components` descriptor so new sub-components (e.g. Re-engagement After
 * Silence) show up without touching this file.
 */
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/navigatr";
import { useProfile } from "@/features/auth/useProfile";
import { usePersistenceIndex } from "../hooks/usePersistenceIndex";
import { useTeamPersistenceIndex } from "../hooks/useTeamPersistenceIndex";

function Bar({ label, points, max }: { label: string; points: number; max: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-body-sm">
        <span className="text-text-default">{label}</span>
        <span className="tabular-nums text-text-muted">{points}/{max}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-radius-full bg-surface-sunken">
        <div className="h-full rounded-radius-full bg-brand-primary" style={{ width: `${Math.round((points / max) * 100)}%` }} />
      </div>
    </div>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-heading-sm text-text-default">Persistence index</span>
      <span className="text-caption text-text-muted">{subtitle}</span>
    </div>
  );
}

function Score({ composite, targetScore }: { composite: number; targetScore: number }) {
  return (
    <div className="flex items-end gap-3">
      <span className="text-kpi-lg tabular-nums leading-none text-text-default">{composite}</span>
      <span className="pb-1 text-caption text-text-muted">/ 100 · target {targetScore}</span>
    </div>
  );
}

function WidgetButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded-radius-md"
    >
      <div className="flex flex-col gap-4">{children}</div>
    </button>
  );
}

/** Reflects-what / not-yet-captured disclosure shown on the manager-only
 *  beta widget, so managers don't mistake the score for a full activity
 *  picture (email capture isn't automatic yet). */
const CAPTURE_DISCLOSURE =
  "Reflects calls, drop-ins, and appointments. Email is not yet captured automatically.";

export function PersistenceIndexWidget() {
  const navigate = useNavigate();
  const role = useProfile().data?.role;
  const isManager = role === "manager" || role === "admin";
  const individual = usePersistenceIndex();
  const team = useTeamPersistenceIndex();
  const openDetail = () => navigate("/dashboard/persistence-index");

  // Managers/admins see the team-aggregate median; reps see their own score
  // (the self-view was re-enabled for reps by user request, reversing the
  // Wave 1 manager-only beta gate).
  if (isManager) {
    const t = team;
    return (
      <Card padding="lg" shadow="sm">
        <WidgetButton onClick={openDetail}>
          <Header subtitle="Your team · last 30 days" />
          {t.composite == null ? (
            <p className="text-body-sm text-text-muted">
              Not enough data yet. Your team hasn't logged enough activity to compute a Persistence Index.
            </p>
          ) : (
            <>
              <Score composite={t.composite} targetScore={t.targetScore} />
              <div className="flex flex-col gap-3">
                {t.components.filter((c) => c.hasSample).map((c) => (
                  <Bar key={c.key} label={c.label} points={c.points} max={c.max} />
                ))}
              </div>
              <p className="text-caption text-text-subtle">
                {t.repCount} {t.repCount === 1 ? "rep" : "reps"}
                {t.range ? ` · range ${t.range.min}-${t.range.max}` : ""}
              </p>
            </>
          )}
          <p className="text-caption text-text-subtle">{CAPTURE_DISCLOSURE}</p>
        </WidgetButton>
      </Card>
    );
  }

  const pi = individual;
  return (
    <Card padding="lg" shadow="sm">
      <WidgetButton onClick={openDetail}>
        <Header subtitle="You · last 30 days" />
        {pi == null || pi.composite == null ? (
          <p className="text-body-sm text-text-muted">
            Not enough data yet. Log activity and set follow-ups to see your Persistence Index.
          </p>
        ) : (
          <>
            <Score composite={pi.composite} targetScore={pi.targetScore} />
            <div className="flex flex-col gap-3">
              {pi.components.filter((c) => c.hasSample).map((c) => (
                <Bar key={c.key} label={c.label} points={c.points} max={c.max} />
              ))}
            </div>
            <p className="text-caption text-text-subtle">
              {pi.followUp.completionRate != null
                ? `${Math.round(pi.followUp.completionRate * 100)}% follow-ups on time`
                : "No follow-ups due"}
              {" · "}
              {pi.cadence.medianTouchesPerWeek != null
                ? `${pi.cadence.medianTouchesPerWeek.toFixed(1)} touches/week across ${pi.cadence.activeDeals} active ${pi.cadence.activeDeals === 1 ? "deal" : "deals"}`
                : "no active deals"}
            </p>
            {pi.caveats.followUpBelowFloor && (
              <p className="text-caption text-text-subtle">
                Follow-up volume too low to score discipline; showing cadence and re-engagement only.
              </p>
            )}
          </>
        )}
      </WidgetButton>
    </Card>
  );
}

export default PersistenceIndexWidget;
