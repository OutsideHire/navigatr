export const DEAL_CONTACT_ROLES: Array<{ value: string; label: string }> = [
  { value: "decision_maker", label: "Decision maker" },
  { value: "gatekeeper", label: "Gatekeeper" },
  { value: "influencer", label: "Influencer" },
  { value: "champion", label: "Champion" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
];

export function roleLabel(value: string | null): string | null {
  if (!value) return null;
  return DEAL_CONTACT_ROLES.find((r) => r.value === value)?.label ?? value;
}
