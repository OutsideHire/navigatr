/**
 * PartnerNoteBacksPanel: on Deal Detail under Source (Partner Portal 2B-3,
 * FR-PORT-78). What a partner wrote back on a referral this deal was sent to
 * them, newest first, one group per partner. Short and scannable; hidden when
 * there is nothing to show.
 */
import { useDealPartnerNotes } from "../hooks/useReferralPartnerNotes";

function shortDate(iso: string): string {
  const d = new Date(iso);
  // With the year: a note can sit on a deal long after it was written.
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function PartnerNoteBacksPanel({ dealId }: { dealId: string }) {
  const { data } = useDealPartnerNotes(dealId);
  if (!data || data.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-border-subtle pt-4">
      {data.map((g) => {
        const title = `Notes from ${g.partnerName ?? "the partner"}`;
        return (
          <section key={g.referralId} aria-label={title} className="flex flex-col gap-2">
            <span className="text-eyebrow text-text-subtle">{title}</span>
            <ul className="flex flex-col gap-2">
              {g.notes.map((n) => (
                <li key={n.id} className="flex flex-col gap-0.5">
                  <p className="whitespace-pre-wrap break-words text-body-md text-text-default">{n.body}</p>
                  <span className="text-caption text-text-subtle">{shortDate(n.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default PartnerNoteBacksPanel;
