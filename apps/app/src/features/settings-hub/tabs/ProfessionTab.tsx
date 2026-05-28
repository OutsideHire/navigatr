/**
 * ProfessionTab — org-level profession picker.
 */
import { ProfessionSettingsCard } from "@/features/profession/components/ProfessionSettingsCard";
import { TabHeader } from "./TabHeader";

export function ProfessionTab() {
  return (
    <>
      <TabHeader
        title="Profession"
        subtitle="Tunes terminology and form fields for your industry."
      />
      <ProfessionSettingsCard />
    </>
  );
}
