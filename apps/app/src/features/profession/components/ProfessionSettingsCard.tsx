/**
 * ProfessionSettingsCard — admin sets the org's profession.
 *
 * v1 surfaces just the profession picker. The per-org terminology +
 * hidden_fields overrides live in the DB (org_profession_config) but
 * we haven't shipped a UI for them yet — the assumption is most ISOs
 * will be happy with the baked-in defaults from terminology.ts. When
 * we need to expose overrides, a "Customize labels" disclosure can
 * land in this same card.
 *
 * "Use per-user default" option clears the org-level setting and falls
 * back to whatever the rep's user_metadata.profession says. That's
 * mainly for orgs migrating from the v0 onboarding flow that haven't
 * standardized on a single profession yet.
 */
import * as React from "react";
import { toast } from "sonner";
import { Button, Card } from "@/components/navigatr";
import { useOrgProfession } from "../useOrgProfession";
import { useUpdateOrgProfession } from "../useUpdateOrgProfession";
import type { Profession } from "../terminology";

interface Option {
  value: Profession | null;
  label: string;
  blurb: string;
}

const OPTIONS: Option[] = [
  {
    value: "merchant_services",
    label: "Merchant services",
    blurb: "Card processing, ISO/MSP channel. Calls deals 'merchants'.",
  },
  {
    value: "payroll",
    label: "Payroll",
    blurb: "Payroll + HR services. Calls dollar metric 'monthly payroll'.",
  },
  {
    value: "treasury_management",
    label: "Treasury management",
    blurb: "Cash management, banking. Calls deals 'relationships'.",
  },
  {
    value: null,
    label: "Use per-user default",
    blurb: "Fall back to each rep's onboarding selection (the v0 behavior).",
  },
];

export function ProfessionSettingsCard() {
  const { data, isLoading } = useOrgProfession();
  const update = useUpdateOrgProfession();
  const [selected, setSelected] = React.useState<Profession | null>(null);

  // Sync local state to the loaded profession on mount + when it changes.
  React.useEffect(() => {
    if (data) setSelected(data.profession);
  }, [data]);

  const dirty = data ? data.profession !== selected : false;

  const onSave = async () => {
    try {
      await update.mutateAsync(selected);
      toast.success("Profession updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update profession");
    }
  };

  return (
    <Card padding="md">
      <h2 className="text-body-strong">Profession</h2>
      <p className="mt-1 text-body-md text-text-muted">
        Tunes terminology + form fields across the app for your industry.
      </p>

      {isLoading && <p className="mt-3 text-body-md text-text-muted">Loading…</p>}

      {!isLoading && (
        <fieldset className="mt-3 flex flex-col gap-2">
          <legend className="sr-only">Profession</legend>
          {OPTIONS.map((opt) => {
            const id = `profession-${opt.value ?? "none"}`;
            const isSelected = selected === opt.value;
            return (
              <label
                key={id}
                htmlFor={id}
                className={
                  // Card-style radio rows; selected gets the brand tint
                  // background + brand-primary border. Subtle enough that
                  // many rows don't dominate the settings page.
                  "flex cursor-pointer items-start gap-3 rounded-radius-sm border px-3 py-2 transition-colors " +
                  (isSelected
                    ? "border-brand-primary bg-brand-primary-10"
                    : "border-border-default hover:bg-surface-sunken")
                }
              >
                <input
                  id={id}
                  type="radio"
                  name="profession"
                  className="mt-1 h-4 w-4"
                  checked={isSelected}
                  onChange={() => setSelected(opt.value)}
                />
                <span className="flex flex-col">
                  <span className="text-body-md text-text-default">{opt.label}</span>
                  <span className="text-caption text-text-muted">{opt.blurb}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="mt-4 flex gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={onSave}
          disabled={!dirty || update.isPending}
          loading={update.isPending}
        >
          Save profession
        </Button>
      </div>
    </Card>
  );
}
