import { Check } from "lucide-react";
import { PlaceholderPage } from "@/features/_placeholder/PlaceholderPage";

export function ActivitiesPage() {
  return (
    <PlaceholderPage
      title="Activities"
      comingInSession={13}
      Icon={Check}
      description="Today's Tasks + recent activity feed. Drop-in / call / email / appointment / partner-touch logging with disposition-driven smart follow-up scheduling."
    />
  );
}
