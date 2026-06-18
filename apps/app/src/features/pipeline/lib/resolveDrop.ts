import type { DealStage } from "../mockData";

/** Decide the target stage for a Kanban drop. Returns the destination stage only
 *  when the card moved to a DIFFERENT column; null otherwise (same column / no drop). */
export function resolveDrop(fromStage: DealStage | undefined, overStage: DealStage | null | undefined): DealStage | null {
  if (!overStage) return null;
  if (fromStage === overStage) return null;
  return overStage;
}
