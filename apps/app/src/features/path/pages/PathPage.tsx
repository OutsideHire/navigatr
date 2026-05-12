import { Compass } from "lucide-react";
import { PlaceholderPage } from "@/features/_placeholder/PlaceholderPage";

export function PathPage() {
  return (
    <PlaceholderPage
      title="Path"
      comingInSession={15}
      Icon={Compass}
      description="Field-route generator: ICP-filtered drop-in path from current location + radius. Google Places / Mapbox integration, stop-by-stop logging, follow-up-back-to-pipeline flow."
    />
  );
}
