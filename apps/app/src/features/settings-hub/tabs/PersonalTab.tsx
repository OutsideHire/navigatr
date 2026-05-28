/**
 * PersonalTab — user-level settings (profile, theme, notifications, account).
 *
 * v1 implementation: wraps the existing SettingsPage component. This keeps
 * the 489-line existing page working unchanged and ships the hub fast.
 * A future cleanup can split SettingsPage's cards into smaller components
 * if the page gets unwieldy. For now, one component = one tab is fine.
 */
import { SettingsPage } from "@/features/settings/pages/SettingsPage";

export function PersonalTab() {
  return <SettingsPage />;
}
