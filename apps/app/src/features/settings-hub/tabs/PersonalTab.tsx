/**
 * PersonalTab — user-level settings (profile, theme, notifications, account).
 *
 * Owns the page H1 + subtitle. The actual sections (Profile, Industry,
 * Appearance, Notifications, Team, Session, Danger zone) live in
 * SettingsPage. This wrapper exists so future tab content swaps (e.g.
 * splitting Profile into its own sub-route) don't churn the H1 design
 * decision.
 */
import { SettingsPage } from "@/features/settings/pages/SettingsPage";
import { TabHeader } from "./TabHeader";

export function PersonalTab() {
  return (
    <>
      <TabHeader
        title="Personal settings"
        subtitle="How you appear and behave across navigatr."
      />
      <SettingsPage />
    </>
  );
}
