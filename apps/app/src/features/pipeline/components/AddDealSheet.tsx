/**
 * AddDealSheet — the biggest form in navigatr.
 *
 * Source: Figma `navigatr v1` Pipeline Action Sheets master frame —
 * 3 profession variants (merchant_services, payroll, treasury_management)
 * × 2 device variants (mobile bottom sheet, desktop centered modal).
 *
 * Pattern (single Radix Dialog, responsive content):
 *   Mobile  → bottom sheet (slide-up from bottom, drag handle, sticky footer)
 *   Desktop → centered modal, max-w-[560px], max-h-[80vh], internal scroll
 *
 * Form (RHF + Zod, profession-conditional schema):
 *   1. Company        — name (req), address, industry, employee count
 *   2. Primary contact — name (req), title, email (req), phone (req)
 *   3. Deal           — value (req), stage (req), probability (req, auto by
 *                       stage unless manually edited), expected close,
 *                       lead source
 *   4. Qualification  — profession-specific fields rendered by branch
 *   5. Notes          — NotesFieldWithMic
 *
 * This file is the canonical template every other form in navigatr will
 * follow: FormField wraps every input, Zod schema lives next to the
 * component, RHF Controller handles the canonical wrappers, the same
 * shell handles mobile + desktop.
 *
 * Sprint 1: mock submit (TanStack Query optimistic insert + toast). Sprint
 * 2 swaps fetchAddDealMock for the generated SDK (Deals.createDeal).
 */

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useForm, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AsYouType } from "libphonenumber-js";
import { useCreateDeal } from "../hooks/useCreateDeal";

/** Strip everything but digits. Used for phone validation + value extraction. */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Format a phone string the way the user expects to see it as they type:
 *  "5555555555" → "(555) 555-5555". Trailing digits/groups grow naturally. */
function formatUSPhone(input: string): string {
  const d = digitsOnly(input);
  if (d.length === 0) return "";
  // AsYouType handles partials nicely (e.g. "555" → "555", "5555" → "(555) 5",
  // "555555" → "(555) 555-5", "5555555555" → "(555) 555-5555"). 11-digit
  // strings starting with 1 get the "+1 …" treatment which is also fine.
  return new AsYouType("US").input(d.slice(0, d.startsWith("1") ? 11 : 10));
}

/** Empty-string → undefined preprocessor for numeric Zod fields. Lets us
 *  default numeric inputs to "" so the placeholder shows. */
const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;
import { X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useAuth, getProfession, type Profession } from "@/stores/auth";
import {
  Button,
  Checkbox,
  FormField,
  Input,
  NotesFieldWithMic,
  Select,
  type SelectOption,
} from "@/components/navigatr";
import { type DealStage } from "../mockData";

// ───────────────────────────────────────────────────────────────────────
// Zod schema — base + profession-conditional refinement via discriminated
// union on the `profession` field. RHF resolves these at submit time.
// ───────────────────────────────────────────────────────────────────────

const STAGE_OPTIONS: SelectOption[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "won", label: "Won" },
];

const INDUSTRY_OPTIONS: SelectOption[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "retail", label: "Retail" },
  { value: "healthcare", label: "Healthcare" },
  { value: "professional_services", label: "Professional Services" },
  { value: "personal_services", label: "Personal Services" },
  { value: "automotive", label: "Automotive" },
  { value: "other", label: "Other" },
];

const EMPLOYEE_COUNT_OPTIONS: SelectOption[] = [
  { value: "1-9", label: "1-9" },
  { value: "10-49", label: "10-49" },
  { value: "50-249", label: "50-249" },
  { value: "250+", label: "250+" },
];

const LEAD_SOURCE_OPTIONS: SelectOption[] = [
  { value: "partner_referral", label: "Partner Referral" },
  { value: "cold_outreach", label: "Cold Outreach" },
  { value: "inbound", label: "Inbound" },
  { value: "path_discovery", label: "Path Discovery" },
  { value: "existing_client", label: "Existing Client" },
  { value: "other", label: "Other" },
];

const PAY_FREQUENCY_OPTIONS: SelectOption[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "semimonthly", label: "Semi-monthly" },
  { value: "monthly", label: "Monthly" },
];

const TIMELINE_OPTIONS: SelectOption[] = [
  { value: "immediate", label: "Immediate" },
  { value: "1-3", label: "1-3 months" },
  { value: "3-6", label: "3-6 months" },
  { value: "6-12", label: "6-12 months" },
  { value: "12+", label: "12+ months" },
];

const ACCEPTANCE_METHODS = [
  "card_present",
  "card_not_present",
  "ecommerce",
  "mobile",
  "in_app",
] as const;
const TREASURY_SERVICES = [
  "ach",
  "wire",
  "lockbox",
  "positive_pay",
  "sweep_accounts",
  "credit_card_processing",
] as const;

const ACCEPTANCE_METHOD_LABELS: Record<(typeof ACCEPTANCE_METHODS)[number], string> = {
  card_present: "Card present",
  card_not_present: "Card not present",
  ecommerce: "E-commerce",
  mobile: "Mobile",
  in_app: "In-app",
};
const TREASURY_SERVICE_LABELS: Record<(typeof TREASURY_SERVICES)[number], string> = {
  ach: "ACH",
  wire: "Wire",
  lockbox: "Lockbox",
  positive_pay: "Positive Pay",
  sweep_accounts: "Sweep Accounts",
  credit_card_processing: "Credit Card Processing",
};

// Base fields shared across all professions
const baseShape = {
  // Company
  companyName: z.string().min(1, "Company name is required"),
  address: z.string().optional(),
  industry: z.string().optional(),
  employeeCountRange: z.string().optional(),

  // Primary contact
  contactName: z.string().min(1, "Contact name is required"),
  contactTitle: z.string().optional(),
  contactEmail: z.string().email("Enter a valid email"),
  // Permissive on purpose: 10 digits (US). libphonenumber's strict "valid"
  // check rejects 555-555-5555 (reserved area code), which is the most-typed
  // test number on Earth. Sprint 2 can tighten if we route real calls.
  contactPhone: z
    .string()
    .min(1, "Phone is required")
    .refine((v) => digitsOnly(v).length === 10, "Enter a 10-digit US phone"),

  // Deal — preprocess empty strings to undefined so the default value "" lets
  // the placeholder show instead of forcing the user to delete a literal "0".
  dealValue: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive("Enter a deal value"),
  ),
  stage: z.enum(["new", "contacted", "qualified", "proposal", "won", "lost"]),
  probability: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(100),
  ),
  expectedClose: z.string().optional(),
  leadSource: z.string().optional(),

  // Notes
  notes: z.string().optional(),
};

const merchantSchema = z.object({
  ...baseShape,
  profession: z.literal("merchant_services"),
  annualVolume: z.coerce.number().nonnegative().optional(),
  acceptanceMethods: z.array(z.enum(ACCEPTANCE_METHODS)).default([]),
  currentProcessor: z.string().optional(),
  currentEffectiveRate: z.coerce.number().nonnegative().max(100).optional(),
  posTerminal: z.string().optional(),
  avgTicketSize: z.coerce.number().nonnegative().optional(),
});

const payrollSchema = z.object({
  ...baseShape,
  profession: z.literal("payroll"),
  currentEmployeeCount: z.coerce.number().int().nonnegative().optional(),
  currentProvider: z.string().optional(),
  payFrequency: z.string().optional(),
  hris: z.string().optional(),
  statesOperating: z.string().optional(),
  renewalDate: z.string().optional(),
});

const treasurySchema = z.object({
  ...baseShape,
  profession: z.literal("treasury_management"),
  annualRevenue: z.coerce.number().nonnegative().optional(),
  currentBank: z.string().optional(),
  servicesInUse: z.array(z.enum(TREASURY_SERVICES)).default([]),
  avgAccountBalance: z.coerce.number().nonnegative().optional(),
  monthsAtBank: z.coerce.number().int().nonnegative().optional(),
  decisionTimeline: z.string().optional(),
});

const dealSchema = z.discriminatedUnion("profession", [
  merchantSchema,
  payrollSchema,
  treasurySchema,
]);

export type DealFormValues = z.infer<typeof dealSchema>;

// Stage → default probability — used both as initial value and as the
// auto-update trigger when stage changes (unless the user has manually
// edited the probability input).
const STAGE_DEFAULT_PROBABILITY: Record<DealStage, number> = {
  new: 20,
  contacted: 35,
  qualified: 55,
  proposal: 75,
  won: 100,
  lost: 0,
};

// ───────────────────────────────────────────────────────────────────────
// Section header — small re-usable so we don't repeat the styling.
// ───────────────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-body-strong text-text-default">{children}</h3>
  );
}

function Divider() {
  return <div className="h-px w-full bg-border-subtle" aria-hidden />;
}

// ───────────────────────────────────────────────────────────────────────
// Qualification sections — profession-specific
// ───────────────────────────────────────────────────────────────────────

function MerchantQualification({
  form,
}: {
  form: ReturnType<typeof useForm<DealFormValues>>;
}) {
  const { register, formState: { errors }, control } = form;
  const merchantErrors = errors as Record<string, { message?: string } | undefined>;

  return (
    <>
      <FormField htmlFor="annualVolume" label="Annual processing volume" helper="Last 12 months">
        <Input id="annualVolume" type="number" prefix="$" placeholder="0" {...register("annualVolume" as never)} />
      </FormField>

      <Controller
        control={control}
        name={"acceptanceMethods" as never}
        render={({ field }) => {
          const selected = (field.value as string[] | undefined) ?? [];
          return (
            <FormField htmlFor="acceptanceMethods" label="Acceptance methods">
              <div id="acceptanceMethods" className="flex flex-col gap-2">
                {ACCEPTANCE_METHODS.map((m) => (
                  <Checkbox
                    key={m}
                    id={`acceptance-${m}`}
                    label={ACCEPTANCE_METHOD_LABELS[m]}
                    checked={selected.includes(m)}
                    onCheckedChange={(c) => {
                      const next = c
                        ? Array.from(new Set([...selected, m]))
                        : selected.filter((s) => s !== m);
                      field.onChange(next);
                    }}
                  />
                ))}
              </div>
            </FormField>
          );
        }}
      />

      <FormField htmlFor="currentProcessor" label="Current processor">
        <Input id="currentProcessor" placeholder="e.g., Square, Stripe, First Data" {...register("currentProcessor" as never)} />
      </FormField>

      <FormField htmlFor="currentEffectiveRate" label="Current effective rate" helper="From their most recent statement"
        error={merchantErrors.currentEffectiveRate?.message}>
        <Input id="currentEffectiveRate" type="number" step="0.01" suffix="%" placeholder="2.5" {...register("currentEffectiveRate" as never)} />
      </FormField>

      <FormField htmlFor="posTerminal" label="POS / terminal">
        <Input id="posTerminal" placeholder="e.g., Clover, Square, Toast" {...register("posTerminal" as never)} />
      </FormField>

      <FormField htmlFor="avgTicketSize" label="Avg ticket size">
        <Input id="avgTicketSize" type="number" prefix="$" placeholder="0" {...register("avgTicketSize" as never)} />
      </FormField>
    </>
  );
}

function PayrollQualification({
  form,
}: {
  form: ReturnType<typeof useForm<DealFormValues>>;
}) {
  const { register, control } = form;

  return (
    <>
      <FormField htmlFor="currentEmployeeCount" label="Employee count (current)">
        <Input id="currentEmployeeCount" type="number" placeholder="0" {...register("currentEmployeeCount" as never)} />
      </FormField>

      <FormField htmlFor="currentProvider" label="Current payroll provider">
        <Input id="currentProvider" placeholder="e.g., ADP, Paychex, Gusto" {...register("currentProvider" as never)} />
      </FormField>

      <Controller
        control={control}
        name={"payFrequency" as never}
        render={({ field }) => (
          <FormField htmlFor="payFrequency" label="Pay frequency">
            <Select
              id="payFrequency"
              value={(field.value as string | undefined) ?? ""}
              onValueChange={field.onChange}
              options={PAY_FREQUENCY_OPTIONS}
              placeholder="Select frequency"
            />
          </FormField>
        )}
      />

      <FormField htmlFor="hris" label="HRIS in use">
        <Input id="hris" placeholder="If any" {...register("hris" as never)} />
      </FormField>

      <FormField htmlFor="statesOperating" label="States operating in" helper="Comma-separated, e.g., CA, TX, NY">
        <Input id="statesOperating" placeholder="CA, TX, NY" {...register("statesOperating" as never)} />
      </FormField>

      <FormField htmlFor="renewalDate" label="Renewal date" helper="When their current contract renews">
        <Input id="renewalDate" type="date" {...register("renewalDate" as never)} />
      </FormField>
    </>
  );
}

function TreasuryQualification({
  form,
}: {
  form: ReturnType<typeof useForm<DealFormValues>>;
}) {
  const { register, control } = form;

  return (
    <>
      <FormField htmlFor="annualRevenue" label="Annual revenue">
        <Input id="annualRevenue" type="number" prefix="$" placeholder="0" {...register("annualRevenue" as never)} />
      </FormField>

      <FormField htmlFor="currentBank" label="Current bank">
        <Input id="currentBank" placeholder="Primary banking relationship" {...register("currentBank" as never)} />
      </FormField>

      <Controller
        control={control}
        name={"servicesInUse" as never}
        render={({ field }) => {
          const selected = (field.value as string[] | undefined) ?? [];
          return (
            <FormField htmlFor="servicesInUse" label="Services in use">
              <div id="servicesInUse" className="flex flex-col gap-2">
                {TREASURY_SERVICES.map((s) => (
                  <Checkbox
                    key={s}
                    id={`service-${s}`}
                    label={TREASURY_SERVICE_LABELS[s]}
                    checked={selected.includes(s)}
                    onCheckedChange={(c) => {
                      const next = c
                        ? Array.from(new Set([...selected, s]))
                        : selected.filter((x) => x !== s);
                      field.onChange(next);
                    }}
                  />
                ))}
              </div>
            </FormField>
          );
        }}
      />

      <FormField htmlFor="avgAccountBalance" label="Avg account balance">
        <Input id="avgAccountBalance" type="number" prefix="$" placeholder="0" {...register("avgAccountBalance" as never)} />
      </FormField>

      <FormField htmlFor="monthsAtBank" label="Months at bank">
        <Input id="monthsAtBank" type="number" placeholder="0" {...register("monthsAtBank" as never)} />
      </FormField>

      <Controller
        control={control}
        name={"decisionTimeline" as never}
        render={({ field }) => (
          <FormField htmlFor="decisionTimeline" label="Decision timeline">
            <Select
              id="decisionTimeline"
              value={(field.value as string | undefined) ?? ""}
              onValueChange={field.onChange}
              options={TIMELINE_OPTIONS}
              placeholder="Select timeline"
            />
          </FormField>
        )}
      />
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────
// AddDealSheet
// ───────────────────────────────────────────────────────────────────────

export interface AddDealSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddDealSheet({ open, onOpenChange }: AddDealSheetProps) {
  const user = useAuth((s) => s.user);
  const profession: Profession = getProfession(user) ?? "merchant_services";
  const createDeal = useCreateDeal();

  // Tracks whether the user has manually edited probability. Once they
  // type into the field, stage changes no longer overwrite it.
  const probabilityTouched = React.useRef(false);

  const defaultValues = React.useMemo<DealFormValues>(() => {
    const base = {
      companyName: "",
      address: "",
      industry: undefined,
      employeeCountRange: undefined,
      contactName: "",
      contactTitle: "",
      contactEmail: "",
      contactPhone: "",
      // Empty-string defaults so the placeholder shows. Schema preprocess
      // turns "" into undefined → triggers the "required" error on submit.
      dealValue: "" as unknown as number,
      stage: "new" as DealStage,
      probability: "" as unknown as number,
      expectedClose: "",
      leadSource: undefined,
      notes: "",
    };
    if (profession === "payroll") {
      return { ...base, profession: "payroll" } as DealFormValues;
    }
    if (profession === "treasury_management") {
      return { ...base, profession: "treasury_management", servicesInUse: [] } as DealFormValues;
    }
    return { ...base, profession: "merchant_services", acceptanceMethods: [] } as DealFormValues;
  }, [profession]);

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealSchema),
    defaultValues,
    mode: "onBlur",
  });
  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  // Reset form when profession changes (e.g. user switches tenants).
  React.useEffect(() => {
    reset(defaultValues);
    probabilityTouched.current = false;
  }, [defaultValues, reset]);

  // Stage → probability auto-update unless the user has manually edited.
  const watchedStage = watch("stage");
  React.useEffect(() => {
    if (!probabilityTouched.current && watchedStage) {
      setValue("probability", STAGE_DEFAULT_PROBABILITY[watchedStage]);
    }
  }, [watchedStage, setValue]);

  const onSubmit: SubmitHandler<DealFormValues> = async (values) => {
    // Split the form into typed columns + profession-specific bucket.
    // Base fields map 1:1 onto the deals table columns; the rest of the
    // discriminated-union variant goes into profession_data JSONB so we
    // can keep the merchant/payroll/treasury form variants without
    // sprouting 20 nullable columns per profession.
    const {
      companyName, address, industry, employeeCountRange,
      contactName, contactTitle, contactEmail, contactPhone,
      dealValue, stage, probability, expectedClose, leadSource, notes,
      profession: _profession,
      ...professionFields
    } = values;

    try {
      await createDeal.mutateAsync({
        companyName,
        address,
        industry,
        employeeCountRange,
        contactName,
        contactTitle,
        contactEmail,
        // Normalize to E.164 ("+1XXXXXXXXXX"). The form validator already
        // guarantees 10 digits; PhoneWithClickToCall on the deal card
        // requires E.164 to render without an "Invalid number" error.
        contactPhone: "+1" + digitsOnly(contactPhone),
        valueCents: Math.round(dealValue * 100),
        stage,
        probability,
        expectedClose: expectedClose || null,
        leadSource,
        notes,
        nextFollowupAt: expectedClose ? new Date(expectedClose).toISOString() : null,
        professionData: { profession: _profession, ...professionFields },
      });
      toast.success("Deal added");
      reset(defaultValues);
      probabilityTouched.current = false;
      onOpenChange(false);
    } catch (err) {
      // RLS denial, network failure, validation server-side — surface raw
      // message. We do NOT close the sheet so the user can retry without
      // re-entering the whole form.
      toast.error(err instanceof Error ? err.message : "Could not create deal");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-40 bg-black/40",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col bg-surface-default text-text-default shadow-card-hover",
            // Mobile: bottom sheet — full width, max 90vh, slide up from bottom.
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-radius-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            // Desktop: centered modal — fixed width, max 80vh, slide-from-center fade.
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-[560px] sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:rounded-radius-lg sm:max-h-[80vh]",
            "sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
            "sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:fade-out-0",
            "sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0",
          )}
        >
          {/* Drag handle — mobile only, visual affordance for swipe-to-dismiss. */}
          <div className="flex shrink-0 justify-center pt-2 sm:hidden" aria-hidden>
            <div className="h-1 w-10 rounded-radius-full bg-border-default" />
          </div>

          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-3 sm:pt-5">
            <Dialog.Title className="text-heading-sm text-text-default">
              Add new deal
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-radius-sm text-text-muted hover:bg-surface-sunken hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Scrollable form body */}
          <form
            id="add-deal-form"
            onSubmit={handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4"
            noValidate
          >
            <div className="flex flex-col gap-6">
              {/* Section 1: Company */}
              <section className="flex flex-col gap-3">
                <SectionHeader>Company</SectionHeader>
                <FormField htmlFor="companyName" label="Company name" required error={errors.companyName?.message}>
                  <Input id="companyName" placeholder="e.g., Sunset Cafe" {...register("companyName")} />
                </FormField>
                <FormField htmlFor="address" label="Address" helper="We'll geocode for Path">
                  <Input id="address" placeholder="Street address" {...register("address")} />
                </FormField>
                <Controller
                  control={control}
                  name="industry"
                  render={({ field }) => (
                    <FormField htmlFor="industry" label="Industry">
                      <Select
                        id="industry"
                        value={field.value ?? ""}
                        onValueChange={field.onChange}
                        options={INDUSTRY_OPTIONS}
                        placeholder="Select industry"
                      />
                    </FormField>
                  )}
                />
                <Controller
                  control={control}
                  name="employeeCountRange"
                  render={({ field }) => (
                    <FormField htmlFor="employeeCountRange" label="Employee count">
                      <Select
                        id="employeeCountRange"
                        value={field.value ?? ""}
                        onValueChange={field.onChange}
                        options={EMPLOYEE_COUNT_OPTIONS}
                        placeholder="Select range"
                      />
                    </FormField>
                  )}
                />
              </section>

              <Divider />

              {/* Section 2: Primary contact */}
              <section className="flex flex-col gap-3">
                <SectionHeader>Primary contact</SectionHeader>
                <FormField htmlFor="contactName" label="Contact name" required error={errors.contactName?.message}>
                  <Input id="contactName" placeholder="Full name" {...register("contactName")} />
                </FormField>
                <FormField htmlFor="contactTitle" label="Title / role">
                  <Input id="contactTitle" placeholder="Owner, Manager, etc." {...register("contactTitle")} />
                </FormField>
                <FormField htmlFor="contactEmail" label="Email" required error={errors.contactEmail?.message}>
                  <Input id="contactEmail" type="email" placeholder="contact@company.com" {...register("contactEmail")} />
                </FormField>
                <Controller
                  control={control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormField htmlFor="contactPhone" label="Phone" required error={errors.contactPhone?.message}>
                      <Input
                        id="contactPhone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="(555) 123-4567"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(formatUSPhone(e.target.value))}
                        onBlur={field.onBlur}
                      />
                    </FormField>
                  )}
                />
              </section>

              <Divider />

              {/* Section 3: Deal */}
              <section className="flex flex-col gap-3">
                <SectionHeader>Deal</SectionHeader>
                <FormField htmlFor="dealValue" label="Deal value" required error={errors.dealValue?.message}>
                  <Input id="dealValue" type="number" prefix="$" placeholder="0" {...register("dealValue")} />
                </FormField>
                <Controller
                  control={control}
                  name="stage"
                  render={({ field }) => (
                    <FormField htmlFor="stage" label="Stage" required error={errors.stage?.message}>
                      <Select
                        id="stage"
                        value={field.value}
                        onValueChange={(v) => field.onChange(v as DealStage)}
                        options={STAGE_OPTIONS}
                      />
                    </FormField>
                  )}
                />
                <FormField htmlFor="probability" label="Win probability" required error={errors.probability?.message}>
                  <Input
                    id="probability"
                    type="number"
                    suffix="%"
                    placeholder="20"
                    {...register("probability", {
                      onChange: () => {
                        // Once the user types here, stop auto-syncing from stage.
                        probabilityTouched.current = true;
                      },
                    })}
                  />
                </FormField>
                <FormField htmlFor="expectedClose" label="Expected close">
                  <Input id="expectedClose" type="date" {...register("expectedClose")} />
                </FormField>
                <Controller
                  control={control}
                  name="leadSource"
                  render={({ field }) => (
                    <FormField htmlFor="leadSource" label="Lead source">
                      <Select
                        id="leadSource"
                        value={field.value ?? ""}
                        onValueChange={field.onChange}
                        options={LEAD_SOURCE_OPTIONS}
                        placeholder="Select source"
                      />
                    </FormField>
                  )}
                />
              </section>

              <Divider />

              {/* Section 4: Qualification — profession-specific */}
              <section className="flex flex-col gap-3">
                <SectionHeader>Qualification</SectionHeader>
                {profession === "merchant_services" && <MerchantQualification form={form} />}
                {profession === "payroll" && <PayrollQualification form={form} />}
                {profession === "treasury_management" && <TreasuryQualification form={form} />}
              </section>

              <Divider />

              {/* Section 5: Notes */}
              <section className="flex flex-col gap-3">
                <SectionHeader>Notes</SectionHeader>
                <Controller
                  control={control}
                  name="notes"
                  render={({ field }) => (
                    <FormField htmlFor="notes" label="Notes" showLabel={false}>
                      <NotesFieldWithMic
                        id="notes"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder="Anything important about this deal..."
                      />
                    </FormField>
                  )}
                />
              </section>
            </div>
          </form>

          {/* Sticky footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-surface-default px-5 py-3">
            <Dialog.Close asChild>
              <Button type="button" variant="tertiary" size="md">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="submit"
              form="add-deal-form"
              variant="primary"
              size="lg"
              loading={isSubmitting}
            >
              Add deal
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default AddDealSheet;
