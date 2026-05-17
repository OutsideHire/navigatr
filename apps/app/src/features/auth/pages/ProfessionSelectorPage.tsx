import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CalendarClock, CreditCard, Landmark, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";
import { Logo } from "@/components/layout/Logo";
import { useAuth, type Profession } from "@/stores/auth";

interface Option {
  value: Profession;
  label: string;
  description: string;
  Icon: typeof CreditCard;
  accent: string; // tailwind classes for the icon tile
}

const OPTIONS: Option[] = [
  {
    value: "payroll",
    label: "Payroll",
    description:
      "Payroll, HR, benefits, and time & attendance. Optimized for cold-call + drop-in workflows targeting SMBs and mid-market.",
    Icon: CalendarClock,
    accent: "bg-accent-teal-20 text-accent-teal",
  },
  {
    value: "merchant_services",
    label: "Merchant Services",
    description:
      "Payment processing, terminals, ISVs. Statement-secured workflows, residual tracking, ICP filtering tuned for merchant-friendly verticals.",
    Icon: CreditCard,
    accent: "bg-accent-violet-20 text-accent-violet",
  },
  {
    value: "treasury_management",
    label: "Treasury Management",
    description:
      "Bank treasury services — lockbox, ACH, FX, fraud. Larger deal sizes, longer cycles, multi-stakeholder qualification.",
    Icon: Landmark,
    accent: "bg-accent-blue-20 text-accent-blue",
  },
];

export function ProfessionSelectorPage() {
  const setProfession = useAuth((s) => s.setProfession);
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Profession | null>(null);
  const [saving, setSaving] = useState(false);

  const onContinue = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await setProfession(selected);
      navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save profession");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col bg-surface-canvas px-4 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
        {/* Brand mark — unified Logo component (user-supplied SVG + Space
            Grotesk wordmark) instead of the early placeholder. */}
        <div className="mb-10">
          <Logo size="md" />
        </div>

        {/* Heading */}
        <div className="mb-8 flex max-w-2xl flex-col gap-2">
          <p className="text-eyebrow text-text-subtle">Step 1 of 1</p>
          <h1 className="text-heading-xl text-text-default sm:text-display-md">
            Which industry do you sell into?
          </h1>
          <p className="text-body-lg text-text-muted">
            We'll tune the ICP filter, qualification questions, and KPI defaults to your industry.
            You can switch later from Settings.
          </p>
        </div>

        {/* Cards */}
        <div className="grid flex-1 gap-4 md:grid-cols-3">
          {OPTIONS.map((opt) => {
            const isActive = selected === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelected(opt.value)}
                aria-pressed={isActive}
                className={cn(
                  "group relative flex flex-col gap-4 rounded-radius-lg border bg-surface-elevated p-6 text-left transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
                  isActive
                    ? "border-brand-primary shadow-md ring-2 ring-brand-primary/30"
                    : "border-border-subtle hover:border-border-default hover:shadow-sm",
                )}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-radius-md",
                      opt.accent,
                    )}
                  >
                    <opt.Icon className="h-6 w-6" />
                  </span>
                  {isActive && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-radius-full bg-brand-primary text-brand-primary-foreground">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <h2 className="text-heading-md text-text-default">{opt.label}</h2>
                  <p className="text-body-md text-text-muted">{opt.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Action */}
        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
          <Button
            size="lg"
            onClick={onContinue}
            disabled={!selected}
            loading={saving}
            className="sm:min-w-[180px]"
          >
            {saving ? "Saving…" : "Continue to dashboard"}
          </Button>
        </div>
      </div>
    </main>
  );
}
