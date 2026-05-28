/**
 * BrandingTab — white-label settings (product name, primary color, logo,
 * powered-by toggle). Thin wrapper around BrandSettingsCard since the
 * card already implements the whole form.
 */
import { BrandSettingsCard } from "@/features/branding/components/BrandSettingsCard";

export function BrandingTab() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-heading-lg">Branding</h2>
      <BrandSettingsCard />
    </div>
  );
}
