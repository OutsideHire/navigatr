import { Sliders } from "lucide-react";
import { PlaceholderPage } from "@/features/_placeholder/PlaceholderPage";

export function SettingsPage() {
  return (
    <PlaceholderPage
      title="Settings"
      comingInSession={16}
      Icon={Sliders}
      description="Profile, tenant branding (white-label), integrations (Salesforce/HubSpot/Gmail/Outlook/Calendar), user management, billing, and ICP filter overrides."
    />
  );
}
