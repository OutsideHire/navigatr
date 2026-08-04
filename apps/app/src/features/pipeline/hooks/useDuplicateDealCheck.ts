/**
 * useDuplicateDealCheck — soft, pre-submit "is this business already in the
 * pipeline?" lookup for the Add-deal form.
 *
 * Calls find_active_duplicate_deal (migration 20260804000002), which normalizes
 * the given name+address the same way the hard de-dup guard does and returns the
 * matching ACTIVE deal in the caller's org, if any. The form uses this to warn
 * and offer "open it instead" BEFORE the insert, so the rep sees a friendly
 * prompt rather than the create failing on the database trigger.
 *
 * This is advisory only — the trigger is still the guarantee. A lookup error is
 * swallowed (returns null) so a transient failure never blocks a legitimate add;
 * the trigger will still catch a true duplicate on submit.
 */
import * as React from "react";
import { supabase } from "@/lib/supabase";

export interface DuplicateDealMatch {
  id: string;
  companyName: string;
  stage: string;
  ownerId: string | null;
}

interface FindDuplicateRpcRow {
  id: string;
  company_name: string;
  stage: string;
  owner_id: string | null;
}

/** Returns a stable `checkDuplicate(name, address)` that resolves to the first
 *  active duplicate deal, or null when there is none / the inputs can't be keyed
 *  (blank name or address) / the lookup errors. */
export function useDuplicateDealCheck(): {
  checkDuplicate: (name: string, address: string | undefined) => Promise<DuplicateDealMatch | null>;
} {
  const checkDuplicate = React.useCallback(
    async (name: string, address: string | undefined): Promise<DuplicateDealMatch | null> => {
      // No address → no reliable key → the guard won't fire, so don't bother.
      if (!name?.trim() || !address?.trim()) return null;
      const { data, error } = await supabase.rpc("find_active_duplicate_deal", {
        p_name: name,
        p_address: address,
      });
      if (error) return null; // advisory only — never block on a lookup failure
      const row = ((data ?? []) as unknown as FindDuplicateRpcRow[])[0];
      if (!row) return null;
      return {
        id: row.id,
        companyName: row.company_name,
        stage: row.stage,
        ownerId: row.owner_id,
      };
    },
    [],
  );
  return { checkDuplicate };
}
