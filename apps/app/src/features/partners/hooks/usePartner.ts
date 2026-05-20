/**
 * usePartner(partnerId) — single-partner lookup, subscribed to the
 * partners list query.
 *
 * Composes usePartners() so the detail page sees the same source of
 * truth as the list. React Query dedupes the fetch by query key — no
 * duplicate request when both /partners and /partners/:id are mounted
 * in the same session.
 *
 * Same pattern as useDeal: subscribe to the list, find by id in a
 * memo. isLoading from the list keeps the spinner up on cold-cache
 * deep-links so we don't flash NotFound for a real partner.
 */

import * as React from "react";
import { type Partner } from "../mockData";
import { usePartners } from "./usePartners";

export interface UsePartnerResult {
  partner: Partner | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function usePartner(partnerId: string | undefined): UsePartnerResult {
  const { data: partners, isLoading, isError } = usePartners();

  const partner = React.useMemo<Partner | undefined>(() => {
    if (!partnerId || !partners) return undefined;
    return partners.find((p) => p.id === partnerId);
  }, [partnerId, partners]);

  return { partner, isLoading, isError };
}
