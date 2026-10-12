/**
 * PartnerProfileChanges: the latest name and phone changes the partner made in
 * the portal (FR-PORT-19), on the partner's Contact card. Hidden when none.
 */
import { History } from "lucide-react";
import { usePartnerProfileChanges, type PartnerProfileChange } from "../hooks/usePartnerProfileChanges";

export function describeProfileChange(change: PartnerProfileChange): string {
  if (change.field === "name") return `Partner changed their name to ${change.newValue ?? ""} in the portal`;
  if (change.newValue === null) return "Partner removed their phone in the portal";
  return `Partner changed their phone to ${change.newValue} in the portal`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PartnerProfileChanges({ partnerId }: { partnerId: string }) {
  const { data } = usePartnerProfileChanges(partnerId);
  // portal_purge_user keeps the audit rows but clears both values; there is nothing to say about those.
  const changes = (data ?? []).filter((c) => c.oldValue !== null || c.newValue !== null);
  if (changes.length === 0) return null;
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-text-muted">
        <History className="h-4 w-4" aria-hidden />
      </span>
      <ul className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
        {changes.map((c) => (
          <li key={c.id} className="text-body-sm text-text-muted">
            {`${describeProfileChange(c)} · ${shortDate(c.changedAt)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PartnerProfileChanges;
