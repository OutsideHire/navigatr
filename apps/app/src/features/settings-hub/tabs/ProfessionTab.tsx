/**
 * ProfessionTab — org-level profession picker.
 */
import { ProfessionSettingsCard } from "@/features/profession/components/ProfessionSettingsCard";

export function ProfessionTab() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-heading-lg">Profession</h2>
      <ProfessionSettingsCard />
    </div>
  );
}
