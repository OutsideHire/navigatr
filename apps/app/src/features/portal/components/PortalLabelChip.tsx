/** A partner label as a chip. Only partner labels ever reach the portal (spec 5.6). */
import { Badge, type BadgeKind } from "@/components/navigatr";
import type { PortalLabel } from "../../../../../../supabase/functions/_shared/portalLabels";

const KIND: Record<PortalLabel, BadgeKind> = {
  Received: "status-upcoming",
  Accepted: "stage-new",
  "In Progress": "stage-contacted",
  "Closed Won": "stage-won",
  "Not Moving Forward": "priority-low",
  Withdrawn: "priority-low",
};

export function PortalLabelChip({ label }: { label: PortalLabel }) {
  return (
    <Badge kind={KIND[label]} size="sm" className="shrink-0">
      {label}
    </Badge>
  );
}
