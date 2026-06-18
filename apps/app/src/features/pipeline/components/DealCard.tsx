/**
 * DealCard — Pipeline list card (Figma `navigatr v1` 324:63 / desktop List 325:4).
 *
 * Mono-stage-colored: the 4px left band, the stage pill, and the probability
 * bar all use STAGE_TONE[stage]. Reuses PhoneWithClickToCall for the formatted
 * number + call button; email is a mailto link. Footer is the hybrid form —
 * "Last activity: <date>" ↔ "Next: <verb> · <date>" — pairing the Figma date
 * with the existing STAGE_NEXT_VERB so the next step reads as an instruction.
 */
import { useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";

import { cn } from "@/lib/utils";
import { CardWithStatusBand, PhoneWithClickToCall } from "@/components/navigatr";
import {
  formatMoney,
  formatRelative,
  formatShortDate,
  STAGE_LABEL,
  STAGE_NEXT_VERB,
  STAGE_TONE,
  type Deal,
} from "../mockData";

export function DealCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const tone = STAGE_TONE[deal.stage];
  const verb = STAGE_NEXT_VERB[deal.stage];
  const pct = Math.max(0, Math.min(100, deal.probability));

  return (
    <CardWithStatusBand
      bandColor={tone.band}
      contentPadding="md"
      onClick={() => navigate(`/pipeline/${deal.id}`)}
      aria-label={`${deal.companyName}, ${formatMoney(deal.valueCents)}, ${STAGE_LABEL[deal.stage]}`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-body-strong text-text-default">{deal.companyName}</p>
            <p className="truncate text-body-sm text-text-muted">{deal.contactName}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-heading-sm tabular-nums text-text-default">
              {formatMoney(deal.valueCents)}
            </span>
            <span className={cn("rounded-radius-full px-2 py-0.5 text-caption font-medium", tone.pillBg, tone.pillText)}>
              {STAGE_LABEL[deal.stage]}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <PhoneWithClickToCall phoneNumber={deal.phone} size="sm" />
          {deal.email && (
            <a
              href={`mailto:${deal.email}`}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-radius-sm text-body-sm text-text-muted hover:text-text-default hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{deal.email}</span>
            </a>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium uppercase tracking-wide text-text-muted">
            Probability · {pct}%
          </span>
          <div
            className="h-1.5 w-full overflow-hidden rounded-radius-full bg-surface-sunken"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Win probability"
          >
            <div className={cn("h-full rounded-radius-full", tone.barFill)} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-3 text-caption text-text-muted">
          <span className="truncate">
            Last activity: <span className="tabular-nums">{formatRelative(deal.lastActivity)}</span>
          </span>
          <span className="shrink-0 text-text-default">
            Next: <span className="font-medium">{verb}</span>
            {deal.nextFollowup && (
              <span className="text-text-muted"> · <span className="tabular-nums">{formatShortDate(deal.nextFollowup)}</span></span>
            )}
          </span>
        </div>
      </div>
    </CardWithStatusBand>
  );
}

export default DealCard;
