/**
 * PersistenceIndexWidget — beta Persistence Index. Reps see their own score
 * (Slice 1); managers/admins see the team-aggregate median (Slice 2). Same
 * layout, role-framed labels. Response Velocity is a "coming soon" row; the
 * bars are structured to accept peer-benchmark markers later.
 */
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

function ComingSoonRow() {
  return (
    <div className="flex items-center justify-between text-body-sm opacity-60">
      <span className="text-text-default">Response velocity</span>
      <span className="text-caption text-text-muted">Coming soon</span>
    </div>
  );
}

export function PersistenceIndexWidget() {
  const role = useProfile().data?.role;
  const isManager = role === "manager" || role === "admin";
  const individual = usePersistenceIndex();
  const team = useTeamPersistenceIndex();

  if (isManager) {
    const t = team;
    return (
      <Card padding="lg" shadow="sm">
        <div className="flex flex-col gap-4">
          <Header subtitle="Your team · last 30 days" />
          {t.composite == null ? (
            <p className="text-body-sm text-text-muted">
              Not enough data yet. Your team hasn't logged enough activity to compute a Persistence Index.
            </p>
          ) : (
            <>
              <Score composite={t.composite} targetScore={t.targetScore} />
              <div className="flex flex-col gap-3">
                {t.followUp.points != null && <Bar label="Follow-up discipline" points={t.followUp.points} max={t.followUp.max} />}
                {t.cadence.points != null && <Bar label="Touch cadence" points={t.cadence.points} max={t.cadence.max} />}
                <ComingSoonRow />
              </div>
              <p className="text-caption text-text-subtle">
                {t.repCount} {t.repCount === 1 ? "rep" : "reps"}
                {t.range ? ` · range ${t.range.min}-${t.range.max}` : ""}
              </p>
            </>
          )}
        </div>
      </Card>
    );
  }

  const pi = individual;
  return (
    <Card padding="lg" shadow="sm">
      <div className="flex flex-col gap-4">
        <Header subtitle="You · last 30 days" />
        {pi == null || pi.composite == null ? (
          <p className="text-body-sm text-text-muted">
            Not enough data yet. Log activity and set follow-ups to see your Persistence Index.
          </p>
        ) : (
          <>
            <Score composite={pi.composite} targetScore={pi.targetScore} />
            <div className="flex flex-col gap-3">
              <Bar label="Follow-up discipline" points={pi.followUp.points} max={pi.followUp.max} />
              <Bar label="Touch cadence" points={pi.cadence.points} max={pi.cadence.max} />
              <ComingSoonRow />
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
          </>
        )}
      </div>
    </Card>
  );
}

export default PersistenceIndexWidget;
