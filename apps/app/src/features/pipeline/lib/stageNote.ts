import { STAGE_LABEL, type DealStage } from "../mockData";

/** Prepend a stage-transition note line to a deal's freeform notes. Returns the
 *  existing notes unchanged when `note` is blank. Newest entry on top. */
export function appendStageNote(
  existing: string | null | undefined,
  from: DealStage,
  to: DealStage,
  note: string,
  dateLabel: string,
): string {
  const trimmed = note.trim();
  if (!trimmed) return existing ?? "";
  const line = `[${STAGE_LABEL[from]}→${STAGE_LABEL[to]} · ${dateLabel}] ${trimmed}`;
  return `${line}\n\n${existing ?? ""}`;
}
