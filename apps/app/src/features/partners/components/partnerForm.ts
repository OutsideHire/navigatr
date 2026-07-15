/**
 * partnerForm — shared form contract for the Add and Edit partner sheets.
 *
 * Keeps the zod schema, phone helpers, and select option lists in one
 * place so AddPartnerSheet and EditPartnerSheet can't drift apart. The
 * edit schema is the add schema plus `status` (which the add flow
 * defaults to "active" server-side and doesn't expose).
 */

import { z } from "zod";
import type { SelectOption } from "@/components/navigatr";
import {
  requiredPhoneSchema,
  optionalPhoneSchema,
  requiredEmailSchema,
  optionalEmailSchema,
} from "@/lib/contactValidation";

// Re-export the phone display helpers from their canonical home so existing
// importers (the sheets, partnerForm.test) keep one import site.
export { digitsOnly, formatUSPhone, stripUsCountryCode } from "@/lib/contactValidation";

export const TYPE_OPTIONS: SelectOption[] = [
  { value: "cpa",        label: "CPA" },
  { value: "banker",     label: "Banker" },
  { value: "attorney",   label: "Attorney" },
  { value: "insurance",  label: "Insurance" },
  { value: "consultant", label: "Consultant" },
  { value: "other",      label: "Other" },
];

export const STATUS_OPTIONS: SelectOption[] = [
  { value: "active",   label: "Active" },
  { value: "cooling",  label: "Cooling" },
  { value: "inactive", label: "Inactive" },
];

export const CADENCE_OPTIONS: SelectOption[] = [
  { value: "none", label: "No cadence" },
  { value: "7",    label: "Every 7 days" },
  { value: "14",   label: "Every 14 days" },
  { value: "30",   label: "Every 30 days" },
  { value: "60",   label: "Every 60 days" },
  { value: "90",   label: "Every 90 days" },
];

/** Add-partner fields. Phone + email are required and validated to a US
 *  10-digit number / a valid email. City + notes are optional. */
export const partnerFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  company: z.string().min(1, "Company is required"),
  type: z.enum(["cpa", "banker", "attorney", "insurance", "consultant", "other"]),
  phone: requiredPhoneSchema,
  email: requiredEmailSchema,
  city: z.string().optional(),
  notes: z.string().optional(),
});
export type PartnerFormValues = z.infer<typeof partnerFormSchema>;

/** Edit-partner fields = add fields + status + cadence, with phone/email
 *  relaxed to optional-but-format-checked so a legacy partner missing one
 *  isn't blocked (format is still forced when a value is present). */
export const editPartnerSchema = partnerFormSchema.extend({
  status: z.enum(["active", "cooling", "inactive"]),
  followupCadence: z.string(),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
});
export type EditPartnerValues = z.infer<typeof editPartnerSchema>;
