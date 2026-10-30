import { NAVIGATR_PORTAL_TERMS_TITLE } from "../../../../../../supabase/functions/_shared/portalNavigatrTerms";

/**
 * One checkbox accepts navigatr's Referral Portal Terms and the ISO's partner
 * terms together; the label names exactly what it covers. With no ISO terms it
 * names only navigatr's. No possessive is built from the ISO name, which could
 * already end in "s" (Acme Payments).
 */
export function portalTermsAgreeLabel(orgName: string, isoText: string): string {
  return isoText.trim()
    ? `I agree to the ${NAVIGATR_PORTAL_TERMS_TITLE} and the partner terms from ${orgName}`
    : `I agree to the ${NAVIGATR_PORTAL_TERMS_TITLE}`;
}
