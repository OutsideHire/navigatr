/**
 * usePlaceResolver — client side of the resolve_place edge function
 * (Add-Deal-via-Places slice D).
 *
 * Owns the Places SESSION TOKEN: one token spans a whole "type -> pick" flow so
 * Google bills it as a single Autocomplete session instead of per keystroke.
 * newSession() mints a fresh token (call it when the sheet opens and after each
 * resolved pick or create). autocomplete() and resolveDetails() both send the
 * current token to the edge function.
 *
 * The edge function is mock-first in prod (PLACES_MOCK), so this returns sample
 * businesses at zero cost until live Places is switched on.
 */
import * as React from "react";
import { supabase } from "@/lib/supabase";
import type { PlaceSuggestion, ResolvedPlace } from "./placeResolverTypes";

/** Mint a session-token id. crypto.randomUUID exists in every browser we ship
 *  to; fall back to a timestamped random for the rare jsdom-without-crypto. */
function newToken(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `sess-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export interface PlaceResolver {
  /** Text -> ranked business suggestions. Returns [] below the search floor or
   *  on any error (the caller shows an empty dropdown, never a crash). */
  autocomplete: (input: string, bias?: { lat: number; lng: number }) => Promise<PlaceSuggestion[]>;
  /** placeId -> one resolved business, or null when it can't be resolved. */
  resolveDetails: (placeId: string) => Promise<ResolvedPlace | null>;
  /** Start a new billing session (new token). Call on sheet open + after a pick. */
  newSession: () => void;
}

export function usePlaceResolver(): PlaceResolver {
  const tokenRef = React.useRef<string>(newToken());

  const newSession = React.useCallback(() => {
    tokenRef.current = newToken();
  }, []);

  const autocomplete = React.useCallback(
    async (input: string, bias?: { lat: number; lng: number }): Promise<PlaceSuggestion[]> => {
      try {
        const { data, error } = await supabase.functions.invoke<{ suggestions?: PlaceSuggestion[] }>(
          "resolve_place",
          { body: { action: "autocomplete", input, session_token: tokenRef.current, bias } },
        );
        if (error) return [];
        return data?.suggestions ?? [];
      } catch {
        return [];
      }
    },
    [],
  );

  const resolveDetails = React.useCallback(async (placeId: string): Promise<ResolvedPlace | null> => {
    try {
      const { data, error } = await supabase.functions.invoke<{ place?: ResolvedPlace }>("resolve_place", {
        body: { action: "details", place_id: placeId, session_token: tokenRef.current },
      });
      if (error || !data?.place) return null;
      return data.place;
    } catch {
      return null;
    }
  }, []);

  return { autocomplete, resolveDetails, newSession };
}
