/**
 * RelatedCard — Deal Detail right-rail "Related" (Figma 328:4).
 *
 * Slice 3a shows real data where we have it: the deal's other deals for the same
 * company (from the shared useDeals cache). A "playbook" resource row is a static
 * "Coming soon" stub (no resources system yet). A referrer row is intentionally
 * omitted until inbound attribution is surfaced on the deal (later work).
 */
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/navigatr";
import { useDeals } from "../hooks/useDeals";
import type { Deal } from "../mockData";

export function RelatedCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const { data: deals } = useDeals();
  const others = (deals ?? []).filter((d) => d.companyName === deal.companyName && d.id !== deal.id);

  return (
    <Card padding="md" shadow="sm" className="flex flex-col gap-3">
      <h2 className="text-body-strong text-text-default">Related</h2>
      <div className="flex flex-col">
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => navigate("/pipeline")}
            className="flex items-center justify-between gap-2 rounded-radius-sm py-2 text-left hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <span className="min-w-0">
              <span className="block truncate text-body-sm font-medium text-text-default">
                {deal.companyName}&rsquo;s other deals ({others.length})
              </span>
              <span className="block text-caption text-text-muted">Pipeline</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
          </button>
        )}
        <div className="flex items-center justify-between gap-2 py-2 opacity-60" title="Coming soon">
          <span className="min-w-0">
            <span className="block truncate text-body-sm font-medium text-text-default">Playbook</span>
            <span className="block text-caption text-text-muted">Resource · Coming soon</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
        </div>
      </div>
    </Card>
  );
}

export default RelatedCard;
