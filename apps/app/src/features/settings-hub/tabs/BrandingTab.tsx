/**
 * BrandingTab — white-label settings (product name, primary color, logo,
 * powered-by toggle). Thin wrapper around BrandSettingsCard since the
 * card already implements the whole form.
 */
import { BrandSettingsCard } from "@/features/branding/components/BrandSettingsCard";
import { TabHeader } from "./TabHeader";

export function BrandingTab() {
  return (
    <>
      <TabHeader
        title="Branding"
        subtitle="Customize how navigatr looks for everyone in your workspace."
      />
      <BrandSettingsCard />
    </>
  );
}
