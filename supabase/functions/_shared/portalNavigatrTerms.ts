/**
 * navigatr's own Referral Portal Terms (attorney-approved). Every partner, on
 * every ISO's portal, accepts these alongside the ISO's partner terms; no ISO can
 * edit or remove them. portal_api serves this text and decides which version is
 * current; the database only records the version each partner accepted
 * (portal_users.navigatr_terms_version, 20261031000001_portal_navigatr_terms.sql).
 *
 * Changing the text means changing the version, and changing the version makes
 * every partner accept again at their next request. Keep the wording verbatim.
 */

export const NAVIGATR_PORTAL_TERMS_VERSION = "2026-10-30";

/** The heading the portal renders above the terms (kept out of the body so it shows once). */
export const NAVIGATR_PORTAL_TERMS_TITLE = "Navigatr Referral Portal Terms";

export const NAVIGATR_PORTAL_TERMS_TEXT = `By accessing or using the Navigatr Referral Portal, you acknowledge and agree to the following:

1. Authorized Use: The portal is intended for authorized participants exchanging legitimate business referrals.
2. Referral Information: You agree to submit only information that you are legally permitted to collect, use, and share for the intended referral purpose.
3. Two-Way Referrals: Referral information may be exchanged between authorized Navigatr participants to facilitate business introductions and opportunities.
4. Confidentiality: Information obtained through the portal must be used only for authorized referral-related business purposes and must not be disclosed to unauthorized parties.
5. Data Protection: Participants are responsible for complying with applicable privacy, marketing, and communications laws when contacting referred individuals or businesses.
6. Platform Role: Navigatr provides the technology supporting referral exchanges but does not guarantee referral acceptance, conversion, or resulting business opportunities.
7. Access: Navigatr may restrict or terminate portal access when necessary to protect platform security, privacy, or compliance.`;

/** True when the partner's accepted navigatr version is the current one. */
export function navigatrTermsCurrent(accepted: unknown): boolean {
  return accepted === NAVIGATR_PORTAL_TERMS_VERSION;
}
