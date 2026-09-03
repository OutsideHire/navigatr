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
 * Form (RHF + Zod, profession-conditional schema). Company name + lead source
 * are required; otherwise a rep can save a business as a bare PROSPECT (esp.
 * via Google search, which auto-stamps the source as "places") and qualify it
 * later via Edit. Contact fields + value are optional.
 *   1. Company: name (req), address, industry, employee count
 *   2. Primary contact: name, title, email, phone (all optional)
 *   3. Deal: value (optional), stage (req), probability (req, auto by stage
 *      unless manually edited), expected close, lead source (req)
 *   4. Qualification: profession-specific fields rendered by branch
 *   5. Notes: NotesFieldWithMic
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
import { useForm, Controller, type SubmitHandler, type SubmitErrorHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { REP_SOURCE_OPTIONS, LEAD_SOURCE_LABEL } from "../lib/leadSources";
import { z } from "zod";
import { AsYouType } from "libphonenumber-js";
import { useCreateDeal } from "../hooks/useCreateDeal";
import { usePlaceResolver } from "../hooks/usePlaceResolver";
import { useDealSearchBias } from "../hooks/useDealSearchBias";
import { usePlaceDuplicateCheck } from "../hooks/usePlaceDuplicateCheck";
import { useAttachPlaceToDeal } from "../hooks/useAttachPlaceToDeal";
import { BusinessSearchField } from "./BusinessSearchField";
import { planInterstitial, type InterstitialPlan } from "../lib/placeInterstitial";
import type { ResolvedPlace } from "../hooks/placeResolverTypes";

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
import { dateOnlyToNoonUtcIso } from "@/lib/calendarDate";
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
  { value: "submitted", label: "Negotiation" },
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

/** Map a resolved-place industry (a navigatr IndustryKey from the taxonomy) to
 *  the closest option in this form's smaller INDUSTRY_OPTIONS vocabulary, so a
 *  Business-Search prefill lands on a value the Select (and the edit form) can
 *  round-trip. Unmapped keys fall through to "other". */
const PLACE_INDUSTRY_TO_FORM: Record<string, string> = {
  restaurants_bars_entertainment: "restaurant",
  hospitality: "personal_services",
  retail: "retail",
  convenience_fuel: "retail",
  healthcare: "healthcare",
  veterinary_pet: "healthcare",
  fitness_wellness: "personal_services",
  personal_services: "personal_services",
  sports_recreation: "personal_services",
  professional_services: "professional_services",
  finance_banking: "professional_services",
  education: "professional_services",
  non_profit: "professional_services",
  automotive: "automotive",
  transportation: "automotive",
  manufacturing_wholesale: "other",
  construction_trades: "other",
  other: "other",
};

/** Place metadata carried from a Business-Search pick through to create. */
interface PlaceMeta {
  placeId: string;
  lat: number | null;
  lng: number | null;
  syncedAt: string;
  /** The full resolved place, kept so an "attach to existing" backfill has the
   *  complete field set. */
  place: ResolvedPlace;
}

const EMPLOYEE_COUNT_OPTIONS: SelectOption[] = [
  { value: "1-9", label: "1-9" },
  { value: "10-49", label: "10-49" },
  { value: "50-249", label: "50-249" },
  { value: "250+", label: "250+" },
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

  // Primary contact + value, all optional: a rep adding a business as a PROSPECT
  // (esp. via Google search) shouldn't be forced to fill the contact or a value.
  // Empty fields persist as DB-safe blanks (contact_name/phone "", value_cents 0)
  // so the not-null columns are satisfied; the rep qualifies the deal later via
  // the Edit form. Lead source is the exception: it stays required (see below).
  contactName: z.string().optional(),
  contactTitle: z.string().optional(),
  // Optional: an empty string is allowed (submitted as no email), but a
  // non-empty value must still be a valid email. Email is not required to
  // create a deal (Path QA D).
  contactEmail: z.string().email("Enter a valid email").optional().or(z.literal("")),
  // Optional. When provided it must be 10 US digits (permissive: 555 area codes
  // pass, since 555-555-5555 is the most-typed test number); empty is allowed.
  contactPhone: z
    .string()
    .optional()
    .refine((v) => !v || digitsOnly(v).length === 10, "Enter a 10-digit US phone"),

  // Deal value, optional. Empty preprocesses to undefined (placeholder shows,
  // and a prospect saves at $0); a typed value must be 0 or more (a rep may
  // deliberately enter 0), never negative.
  dealValue: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().nonnegative("Enter a value of 0 or more").optional(),
  ),
  stage: z.enum(["new", "contacted", "qualified", "proposal", "submitted", "won", "lost"]),
  probability: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(100),
  ),
  expectedClose: z.string().optional(),
  // Lead source stays REQUIRED. A search-added deal auto-stamps "places" (the
  // field is locked); a manual deal makes the rep pick one. Only the contact
  // fields + value are optional for a prospect, never the source.
  leadSource: z.string().min(1, "Pick a lead source"),
  leadSourceNote: z.string().optional(),

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

const dealSchema = z
  .discriminatedUnion("profession", [merchantSchema, payrollSchema, treasurySchema])
  .superRefine((val, ctx) => {
    // "Other" lead source requires a free-text note (LS-1).
    if (val.leadSource === "other" && !val.leadSourceNote?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["leadSourceNote"], message: "Add a note for Other" });
    }
  });

export type DealFormValues = z.infer<typeof dealSchema>;

// Stage → default probability — used both as initial value and as the
// auto-update trigger when stage changes (unless the user has manually
// edited the probability input).
const STAGE_DEFAULT_PROBABILITY: Record<DealStage, number> = {
  new: 20,
  contacted: 35,
  qualified: 55,
  proposal: 75,
  submitted: 85,
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
  defaultStage?: DealStage;
}

export function AddDealSheet({ open, onOpenChange, defaultStage }: AddDealSheetProps) {
  const user = useAuth((s) => s.user);
  const profession: Profession = getProfession(user) ?? "merchant_services";
  const createDeal = useCreateDeal();
  const navigate = useNavigate();
  const resolver = usePlaceResolver();
  // Bias the business search to the rep's location (live GPS, else today's path
  // origin) so results are nearby, not nationwide. Gated on `open` so it only
  // asks for location when the sheet is actually opened. See NAVIGATR bug.
  const searchBias = useDealSearchBias(open);
  const { checkPlaceDuplicate } = usePlaceDuplicateCheck();
  const attachPlace = useAttachPlaceToDeal();

  // Tiered de-dup interstitial: the plan a pre-submit check produced (block /
  // soft-confirm / second-location), or null. Cleared when the sheet reopens or
  // the identity fields change.
  const [interstitial, setInterstitial] = React.useState<InterstitialPlan | null>(null);

  // Business-Search provenance for this draft, set when the rep picks a Google
  // result and cleared when they edit the identity fields by hand. Drives the
  // 'places' lead source, coord/place_id stamping, and the attach affordance.
  const [placeMeta, setPlaceMeta] = React.useState<PlaceMeta | null>(null);

  // One-shot bypass: set true when the rep confirms through a soft interstitial
  // ("add anyway" / "add as separate") so the re-submit skips the dup check.
  const bypassDupCheck = React.useRef(false);
  // Parent deal id to link when the rep chose "add as a second location".
  const pendingParentId = React.useRef<string | null>(null);
  // Guards the identity-change effect from wiping placeMeta during a prefill.
  const prefilling = React.useRef(false);

  // Tracks whether the user has manually edited probability. Once they
  // type into the field, stage changes no longer overwrite it.
  const probabilityTouched = React.useRef(false);

  // The dedup interstitial renders at the TOP of a long, scrolled form. Hold a
  // ref so we can bring it into view when it appears: a rep scrolled down to the
  // "Add deal" button would otherwise never see why the save was held.
  const interstitialRef = React.useRef<HTMLDivElement>(null);

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
      // Empty-string defaults so the placeholder shows. Schema preprocess turns
      // "" into undefined: for the optional dealValue that saves as $0; for the
      // still-required probability it triggers the validation error on submit.
      dealValue: "" as unknown as number,
      stage: (defaultStage ?? "new") as DealStage,
      probability: "" as unknown as number,
      expectedClose: "",
      leadSource: "",
      leadSourceNote: "",
      notes: "",
    };
    if (profession === "payroll") {
      return { ...base, profession: "payroll" } as DealFormValues;
    }
    if (profession === "treasury_management") {
      return { ...base, profession: "treasury_management", servicesInUse: [] } as DealFormValues;
    }
    return { ...base, profession: "merchant_services", acceptanceMethods: [] } as DealFormValues;
  }, [profession, defaultStage]);

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

  // Editing the identity fields by hand invalidates any prior interstitial AND
  // the Business-Search provenance (the rep is now describing a different
  // business than the one Google resolved). Skipped during a prefill.
  const watchedCompany = watch("companyName");
  const watchedAddress = watch("address");
  React.useEffect(() => {
    if (prefilling.current) return;
    setInterstitial(null);
    setPlaceMeta(null);
  }, [watchedCompany, watchedAddress]);

  // When a dedup interstitial appears, scroll it into view and echo it as a
  // toast. Both are needed: the banner sits at the top of the form (invisible to
  // a rep scrolled to the button), and the toast gives corner feedback near the
  // action so the held save never reads as a dead button.
  React.useEffect(() => {
    if (!interstitial || interstitial.mode === "none") return;
    interstitialRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    const notify = interstitial.mode === "block" ? toast.error : toast;
    notify(interstitial.title);
  }, [interstitial]);

  // Reset transient state whenever the sheet closes, and start a fresh Places
  // billing session whenever it opens.
  React.useEffect(() => {
    if (open) {
      resolver.newSession();
    } else {
      setInterstitial(null);
      setPlaceMeta(null);
      bypassDupCheck.current = false;
      pendingParentId.current = null;
    }
  }, [open, resolver]);

  // Prefill the form from a picked Business-Search result and record provenance.
  const onResolvePlace = React.useCallback(
    (place: ResolvedPlace) => {
      prefilling.current = true;
      setValue("companyName", place.name, { shouldValidate: true });
      if (place.formattedAddress) setValue("address", place.formattedAddress);
      const formIndustry = PLACE_INDUSTRY_TO_FORM[place.industry];
      if (formIndustry) setValue("industry", formIndustry);
      if (place.phone) setValue("contactPhone", formatUSPhone(place.phone));
      // A places-sourced deal is stamped 'places' at submit; set the field now
      // so the locked "Lead source" row reads 'Business search' for the rep.
      setValue("leadSource", "places", { shouldValidate: true });
      setPlaceMeta({
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
        syncedAt: new Date().toISOString(),
        place,
      });
      setInterstitial(null);
      // Release the prefill guard after this render's effects have run so the
      // identity-change effect doesn't immediately wipe placeMeta.
      requestAnimationFrame(() => {
        prefilling.current = false;
      });
    },
    [setValue],
  );

  const onSubmit: SubmitHandler<DealFormValues> = async (values) => {
    // Split the form into typed columns + profession-specific bucket.
    // Base fields map 1:1 onto the deals table columns; the rest of the
    // discriminated-union variant goes into profession_data JSONB so we
    // can keep the merchant/payroll/treasury form variants without
    // sprouting 20 nullable columns per profession.
    const {
      companyName, address, industry, employeeCountRange,
      contactName, contactTitle, contactEmail, contactPhone,
      dealValue, stage, probability, expectedClose, leadSource, leadSourceNote, notes,
      profession: _profession,
      ...professionFields
    } = values;

    // Phone is optional now: normalize to E.164 only when 10 digits are present,
    // otherwise store "" (a prospect with no phone yet).
    const phoneDigits = digitsOnly(contactPhone ?? "");
    const e164Phone = phoneDigits.length === 10 ? "+1" + phoneDigits : "";

    // Consume the one-shot bypass + pending parent link (set by the
    // interstitial's confirm buttons) so each submit re-evaluates from scratch.
    const bypass = bypassDupCheck.current;
    bypassDupCheck.current = false;
    const parentDealId = pendingParentId.current;
    pendingParentId.current = null;

    // Tiered de-dup pre-check (unless the rep already confirmed through it). A
    // blocking tier stops here with an open/attach choice; a soft tier asks the
    // rep to confirm. Advisory: the DB guard is still the guarantee on insert.
    if (!bypass) {
      const match = await checkPlaceDuplicate({
        placeId: placeMeta?.placeId ?? null,
        name: companyName,
        phone: e164Phone,
        address: address ?? null,
      });
      const plan = planInterstitial(match, !!placeMeta);
      if (plan.mode !== "none") {
        setInterstitial(plan);
        return;
      }
    }

    try {
      await createDeal.mutateAsync({
        companyName,
        address,
        industry,
        employeeCountRange,
        // Optional for a prospect: empty persists as "" (the column is not-null).
        contactName: contactName ?? "",
        contactTitle,
        // Email is optional; send undefined (→ null column) for an empty value
        // so a blank field never persists as "".
        contactEmail: contactEmail?.trim() ? contactEmail : undefined,
        // Normalize to E.164 ("+1XXXXXXXXXX") when 10 digits are present, else
        // "" (phone is optional for a prospect). Only a well-formed E.164 number
        // reaches the card, so PhoneWithClickToCall never sees a partial number.
        contactPhone: e164Phone,
        // Optional for a prospect: no value yet saves as $0 (column is not-null).
        valueCents: dealValue ? Math.round(dealValue * 100) : 0,
        stage,
        probability,
        expectedClose: expectedClose || null,
        // A Business-Search deal is stamped 'places' (rep-directed, auto-set);
        // a manual deal sends the rep's picked source, which the schema requires.
        leadSource: placeMeta ? "places" : leadSource,
        leadSourceNote: !placeMeta && leadSource === "other" ? leadSourceNote?.trim() || null : null,
        notes,
        // expectedClose is a YYYY-MM-DD calendar date; store the mirrored
        // timestamp at noon UTC so cards/hero render the same day the rep
        // picked (new Date(date) parsed as UTC midnight → a day early in the US).
        nextFollowupAt: expectedClose ? dateOnlyToNoonUtcIso(expectedClose) : null,
        professionData: { profession: _profession, ...professionFields },
        // Place provenance (Business-Search only): anchor de-dup + routability.
        placeId: placeMeta?.placeId,
        lat: placeMeta?.lat ?? null,
        lng: placeMeta?.lng ?? null,
        placeSyncedAt: placeMeta?.syncedAt ?? null,
        parentDealId,
      });
      toast.success(parentDealId ? "Second location added" : "Deal added");
      reset(defaultValues);
      probabilityTouched.current = false;
      setPlaceMeta(null);
      setInterstitial(null);
      onOpenChange(false);
    } catch (err) {
      // RLS denial, network failure, validation server-side — surface raw
      // message. We do NOT close the sheet so the user can retry without
      // re-entering the whole form.
      toast.error(err instanceof Error ? err.message : "Could not create deal");
    }
  };

  // Submit blocked by validation. A failing field (company name up top, or a
  // malformed optional like a partial phone) renders above the button, so a rep
  // scrolled to "Add deal" sees nothing happen. Surface it: a toast near the
  // action, plus scroll the first invalid field into view so it is never
  // stranded off-screen.
  const onInvalid: SubmitErrorHandler<DealFormValues> = () => {
    toast.error("Add the missing details highlighted above to save this deal.");
    requestAnimationFrame(() => {
      document
        .getElementById("add-deal-form")
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  // Interstitial actions — all operate on the current form values.
  const openExistingDeal = (dealId: string) => {
    navigate(`/pipeline/${dealId}`);
    onOpenChange(false);
  };

  // "Add anyway" (soft confirm) / "Add as separate" (second location): confirm
  // through the interstitial and re-submit with the dup check bypassed.
  const confirmAndResubmit = () => {
    bypassDupCheck.current = true;
    setInterstitial(null);
    void handleSubmit(onSubmit)();
  };

  // "Add as a second location": link to the matched deal as a sibling.
  const addAsSecondLocation = (parentId: string) => {
    pendingParentId.current = parentId;
    bypassDupCheck.current = true;
    setInterstitial(null);
    void handleSubmit(onSubmit)();
  };

  // "Attach" (blocking match, legacy record without a place_id): backfill the
  // resolved Google fields onto the existing deal instead of creating a new one.
  const attachToExisting = async (dealId: string) => {
    if (!placeMeta) return;
    try {
      await attachPlace.mutateAsync({ dealId, place: placeMeta.place });
      toast.success("Attached to existing deal");
      reset(defaultValues);
      probabilityTouched.current = false;
      setPlaceMeta(null);
      setInterstitial(null);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not attach to the existing deal");
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
            onSubmit={handleSubmit(onSubmit, onInvalid)}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4"
            noValidate
          >
            <div className="flex flex-col gap-6">
              {/* Tiered de-dup interstitial — block / soft-confirm / second-location. */}
              {interstitial && interstitial.mode !== "none" && (
                <div
                  ref={interstitialRef}
                  role="alert"
                  className={cn(
                    "flex flex-col gap-2 rounded-radius-md border px-4 py-3",
                    interstitial.mode === "block"
                      ? "border-status-error/40 bg-status-error-bg"
                      : "border-status-warning/40 bg-status-warning-bg",
                  )}
                >
                  <p
                    className={cn(
                      "text-body-sm font-medium",
                      interstitial.mode === "block" ? "text-status-error" : "text-status-warning",
                    )}
                  >
                    {interstitial.title}
                  </p>
                  <p className="text-caption text-text-muted">{interstitial.body}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {interstitial.dealId && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openExistingDeal(interstitial.dealId!)}
                      >
                        Open existing deal
                      </Button>
                    )}
                    {interstitial.mode === "block" && interstitial.canAttach && interstitial.dealId && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={attachPlace.isPending}
                        onClick={() => void attachToExisting(interstitial.dealId!)}
                      >
                        Attach to existing
                      </Button>
                    )}
                    {interstitial.mode === "confirm" && (
                      <Button type="button" variant="tertiary" size="sm" onClick={confirmAndResubmit}>
                        Add anyway
                      </Button>
                    )}
                    {interstitial.mode === "second_location" && interstitial.dealId && (
                      <>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => addAsSecondLocation(interstitial.dealId!)}
                        >
                          Add as second location
                        </Button>
                        <Button type="button" variant="tertiary" size="sm" onClick={confirmAndResubmit}>
                          Add as separate
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {/* Section 1: Company */}
              <section className="flex flex-col gap-3">
                <SectionHeader>Company</SectionHeader>
                {/* Search-first: resolve a business from Google, or type below. */}
                <FormField
                  htmlFor="business-search"
                  label="Find a business"
                  helper="Search Google, or enter the details manually below"
                >
                  <BusinessSearchField resolver={resolver} onResolve={onResolvePlace} bias={searchBias} />
                </FormField>
                {placeMeta && (
                  <div className="flex items-center gap-2 rounded-radius-sm bg-surface-sunken px-3 py-2">
                    <span className="text-caption font-medium text-text-default">
                      Filled from Google Business Search
                    </span>
                    <button
                      type="button"
                      className="ml-auto text-caption text-text-muted underline hover:text-text-default"
                      onClick={() => {
                        setPlaceMeta(null);
                        setValue("leadSource", "");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                )}
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
                <FormField htmlFor="contactName" label="Contact name" error={errors.contactName?.message}>
                  <Input id="contactName" placeholder="Full name" {...register("contactName")} />
                </FormField>
                <FormField htmlFor="contactTitle" label="Title / role">
                  <Input id="contactTitle" placeholder="Owner, Manager, etc." {...register("contactTitle")} />
                </FormField>
                <FormField htmlFor="contactEmail" label="Email" error={errors.contactEmail?.message}>
                  <Input id="contactEmail" type="email" placeholder="contact@company.com" {...register("contactEmail")} />
                </FormField>
                <Controller
                  control={control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormField htmlFor="contactPhone" label="Phone" error={errors.contactPhone?.message}>
                      <Input
                        id="contactPhone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="(555) 123-4567"
                        value={field.value ?? ""}
                        // Keep the raw typed value while editing so backspacing a
                        // formatting char (e.g. the ")") deletes naturally instead
                        // of AsYouType re-inserting it and stranding the caret.
                        // Format on blur; submit strips to digits regardless.
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={(e) => {
                          field.onChange(formatUSPhone(e.target.value));
                          field.onBlur();
                        }}
                      />
                    </FormField>
                  )}
                />
              </section>

              <Divider />

              {/* Section 3: Deal */}
              <section className="flex flex-col gap-3">
                <SectionHeader>Deal</SectionHeader>
                <FormField htmlFor="dealValue" label="Deal value" error={errors.dealValue?.message}>
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
                {placeMeta ? (
                  <FormField htmlFor="leadSourceLocked" label="Lead source">
                    <Input id="leadSourceLocked" value={LEAD_SOURCE_LABEL.places} readOnly disabled />
                  </FormField>
                ) : (
                  <Controller
                    control={control}
                    name="leadSource"
                    render={({ field }) => (
                      <FormField htmlFor="leadSource" label="Lead source" error={errors.leadSource?.message as string | undefined}>
                        <Select
                          id="leadSource"
                          value={field.value ?? ""}
                          onValueChange={field.onChange}
                          options={REP_SOURCE_OPTIONS}
                          placeholder="Select source"
                        />
                      </FormField>
                    )}
                  />
                )}
                {!placeMeta && watch("leadSource") === "other" && (
                  <Controller
                    control={control}
                    name="leadSourceNote"
                    render={({ field }) => (
                      <FormField
                        htmlFor="leadSourceNote"
                        label="Source note"
                        error={(errors as Record<string, { message?: string } | undefined>).leadSourceNote?.message}
                      >
                        <Input
                          id="leadSourceNote"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder="Where did this lead come from?"
                        />
                      </FormField>
                    )}
                  />
                )}
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
