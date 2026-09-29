/**
 * prospectFill — recover the Places detail a thin Merchant lost on its way to
 * the drop-in sheet.
 *
 * THE BUG THIS EXISTS FOR. A Merchant reaches DropInSheet by several routes and
 * they do not all carry the same fields. `prospectToMerchant` (discovery) is
 * complete. `merchantFromStop` (a saved path stop) is nearly so. But
 * RunningPath's `nearbyMerchant` falls back to building one from a DrivingCard
 * when no saved stop matches, and a card only holds a name, an address and
 * coordinates, so that branch hardcodes `phone: ""` and sets no place id at all.
 *
 * Measured on staging 2026-09-29: three deals created that way had empty phone,
 * empty address and null place_id, while the prospect rows behind them held
 * real addresses, two phone numbers and a website. We had the data the whole
 * time and threw it away at the last step.
 *
 * WHY THE FIX LIVES HERE AND NOT IN nearbyMerchant. Patching that one builder
 * would fix the route we happened to find. This codebase has now had three
 * separate cases of two routes doing one job where only one got fixed. A drop-in
 * always knows its prospect id, so filling the gaps at SAVE time covers every
 * route into the sheet, including ones nobody has found yet.
 *
 * It only ever FILLS. Anything the merchant already carries wins, so a rep's
 * typed value or a fresher card is never overwritten by the cache.
 */
import type { Merchant } from "../mockData";
import { ADDRESS_UNAVAILABLE } from "../hooks/useMerchants";

/** The columns worth recovering. Mirrors the prospects row, snake_case. */
export interface ProspectDetail {
  place_id?: string | null;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
}

/** Blank, whitespace, and the Path display stand-in all count as absent. */
function missing(v: string | null | undefined): boolean {
  const s = v?.trim();
  return !s || s === ADDRESS_UNAVAILABLE;
}

/**
 * True when the merchant is thin enough to be worth a lookup.
 *
 * Website is deliberately NOT a trigger, though it IS filled once we look. Most
 * merchants have no website at all, so triggering on it would make nearly every
 * drop-in pay for a query that finds nothing. And a merchant that already has a
 * place id, an address and a phone came from discovery, which reads website off
 * the same prospect row anyway, so there is nothing left to recover.
 */
export function needsProspectFill(m: Merchant): boolean {
  return missing(m.placeId) || missing(m.address) || missing(m.phone);
}

/** Fill only what is absent. The merchant always wins where it has a value. */
export function mergeProspectDetail(m: Merchant, p: ProspectDetail | null | undefined): Merchant {
  if (!p) return m;
  return {
    ...m,
    placeId: missing(m.placeId) ? (p.place_id ?? undefined) : m.placeId,
    address: missing(m.address) ? (p.address ?? m.address) : m.address,
    phone: missing(m.phone) ? (p.phone ?? m.phone) : m.phone,
    website: missing(m.website) ? (p.website ?? undefined) : m.website,
  };
}
