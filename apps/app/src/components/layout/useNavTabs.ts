/**
 * useNavTabs — returns the main nav tabs with profession-aware labels.
 *
 * Why a hook (not a static export): the "Pipeline" tab's label varies by
 * org profession ("Book" for treasury, "Pipeline" for merchant services
 * and payroll). Hooks compose; constants don't.
 *
 * Both SidebarNav (desktop) and BottomNav (mobile) consume this so the
 * label flip applies uniformly across breakpoints.
 *
 * Icons and routes are stable — only labels change.
 */
import { MAIN_TABS, type NavTabSpec } from "./nav-tabs";
import { useTermCapitalized } from "@/features/profession/useTerm";

export function useNavTabs(): NavTabSpec[] {
  // Only "Pipeline" varies today. If future tabs gain profession-aware
  // labels, add a case here. Keep MAIN_TABS as the source of truth for
  // ordering + icons; this hook overrides labels selectively.
  const pipelineLabel = useTermCapitalized("pipeline");
  return MAIN_TABS.map((tab) =>
    tab.key === "pipeline" ? { ...tab, label: pipelineLabel } : tab,
  );
}
