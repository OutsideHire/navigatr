/**
 * useTerm + useFieldVisible — the consumer-facing hooks.
 *
 * Both read useOrgProfession() (single query, both hooks share its cache).
 * useTerm resolves abstract TermKey → display string with fallback chain.
 * useFieldVisible resolves a field name against the org's hidden_fields.
 *
 * Usage:
 *   const dealsLabel = useTerm("deals");          // "merchants" for an
 *                                                  // M-services org with override
 *   const showVolume = useFieldVisible("annual_volume");
 *
 * Both hooks return STABLE primitives (string / boolean) so passing them
 * to props doesn't break memo equality.
 */
import { useOrgProfession } from "./useOrgProfession";
import { resolveTerm, type TermKey, TERM_FALLBACKS } from "./terminology";

/**
 * Resolve a TermKey to its profession-appropriate label.
 * Returns the fallback string while the query is still loading — better
 * than rendering nothing or a flash of "deal" → "policy" at hydrate time.
 */
export function useTerm(key: TermKey): string {
  const { data } = useOrgProfession();
  if (!data) return TERM_FALLBACKS[key];
  return resolveTerm(key, data.profession, data.terminology);
}

/**
 * Is `field` visible for the current org? Returns true if the field is
 * NOT in org_profession_config.hidden_fields. Loading state defaults to
 * "true" so legacy components that don't know about this hook keep working.
 */
export function useFieldVisible(field: string): boolean {
  const { data } = useOrgProfession();
  if (!data) return true;
  return !data.hiddenFields.includes(field);
}

/**
 * Like useTerm, but capitalized for sentence-start use ("Add deal" →
 * "Add Deal" wouldn't be right; "Add deal" → with this helper at the
 * start, "Deal" is correct.)
 *
 * Use this for page headers, button labels that lead a sentence, and
 * section titles. For "X deals closed" mid-sentence, use plain useTerm.
 */
export function useTermCapitalized(key: TermKey): string {
  const t = useTerm(key);
  if (t.length === 0) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
