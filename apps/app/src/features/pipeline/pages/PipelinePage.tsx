import { TrendingUp } from "lucide-react";
import { PlaceholderPage } from "@/features/_placeholder/PlaceholderPage";

export function PipelinePage() {
  return (
    <PlaceholderPage
      title="Pipeline"
      comingInSession={12}
      Icon={TrendingUp}
      description="Deal pipeline with stage filtering, drag-to-stage transitions, weighted forecast totals, and Add New Deal sheet. Hits the deals/* API endpoints from packages/contracts."
    />
  );
}
