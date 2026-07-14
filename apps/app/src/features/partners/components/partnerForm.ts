/**
 * partnerForm — shared form contract for the Add and Edit partner sheets.
 *
 * Keeps the zod schema, phone helpers, and select option lists in one
 * place so AddPartnerSheet and EditPartnerSheet can't drift apart. The
 * edit schema is the add schema plus `status` (which the add flow
 * defaults to "active" server-side and doesn't expose).
 */

import { z } from "zod";
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js";
import type { SelectOption } from "@/components/navigatr";

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

export function formatUSPhone(input: string): string {
  const d = digitsOnly(input);
  if (d.length === 0) return "";
  return new AsYouType("US").input(d.slice(0, d.startsWith("1") ? 11 : 10));
}

/** Stored phones are E.164 ("+15555555555"). The validator wants exactly
 *  10 digits; pre-filling "1 (555) 555-5555" would fail and force a
 *  re-type. Strip the leading US country code so the form sees 10 digits. */
export function stripUsCountryCode(phone: string): string {
  const d = digitsOnly(phone);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

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

/** Add-partner fields. Phone + email are required and validated to a US
 *  10-digit number / a valid email. City + notes are optional. */
export const partnerFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  company: z.string().min(1, "Company is required"),
  type: z.enum(["cpa", "banker", "attorney", "insurance", "consultant", "other"]),
  phone: z
    .string()
    .min(1, "Phone is required")
    .refine(
      (v) => parsePhoneNumberFromString(v, "US")?.isValid() || digitsOnly(v).length === 10,
      "Enter a 10-digit US phone",
    ),
  email: z.string().email("Enter a valid email"),
  city: z.string().optional(),
  notes: z.string().optional(),
});
export type PartnerFormValues = z.infer<typeof partnerFormSchema>;

/** Edit-partner fields = add fields + editable status. */
export const editPartnerSchema = partnerFormSchema.extend({
  status: z.enum(["active", "cooling", "inactive"]),
});
export type EditPartnerValues = z.infer<typeof editPartnerSchema>;
