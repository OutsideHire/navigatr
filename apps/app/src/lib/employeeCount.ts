/**
 * Business size as an employee count (FR-PORT-35, Q10). The Add/Edit Deal
 * pickers use the same four buckets as the partner referral forms, so a
 * referral's answer lands on the deal as a value the pickers know. The list
 * lives with the referral rules (the edge cannot import app code); this is the
 * app's one way in.
 */
import { EMPLOYEE_COUNT_OPTIONS } from "../../../../supabase/functions/_shared/portalSubmission";

export { EMPLOYEE_COUNT_OPTIONS };
export type { EmployeeCount } from "../../../../supabase/functions/_shared/portalSubmission";

/**
 * What to show for a deal's stored employee count: the bucket's label when it
 * is one of the four, the stored text as it is otherwise (older or imported
 * values), or null when there is nothing to show.
 */
export function employeeCountLabel(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (v === "") return null;
  return EMPLOYEE_COUNT_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
