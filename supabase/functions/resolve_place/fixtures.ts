// Mock Google Places (New) autocomplete + details for PLACES_MOCK=1.
//
// Lets the whole Add-Deal-via-Places search flow run with zero API cost and no
// key: the resolver returns these fixtures, shaped exactly like the live
// autocomplete / place-details responses so flipping PLACES_MOCK off is a
// drop-in. The set covers the dedupe branches slice C/D exercise:
//   - a clean independent SMB (Pat's Family Diner) — no existing match
//   - a dental office (Riverside Dental) — reused as a "same place_id" case
//   - a second location of a known merchant (Lone Star HVAC - North)
//   - a chain (Subway) — resolvable but rarely a real deal target

import type { GoogleAutocompleteResponse, GooglePlaceDetails } from "../_shared/placeResolve.ts";

interface MockPlace {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  primaryType: string;
  types: string[];
  phone?: string;
}

const MOCK_PLACES: MockPlace[] = [
  {
    id: "mock_place_pats_diner",
    name: "Pat's Family Diner",
    address: "101 Congress Ave, Austin, TX 78701",
    lat: 30.2649,
    lng: -97.7431,
    primaryType: "restaurant",
    types: ["restaurant", "food", "point_of_interest", "establishment"],
    phone: "(512) 555-0101",
  },
  {
    id: "mock_place_riverside_dental",
    name: "Riverside Dental Group",
    address: "512 Riverside Dr, Austin, TX 78704",
    lat: 30.2461,
    lng: -97.7351,
    primaryType: "dentist",
    types: ["dentist", "health", "point_of_interest", "establishment"],
    phone: "(512) 555-0105",
  },
  {
    id: "mock_place_lonestar_hvac_north",
    name: "Lone Star HVAC Services - North",
    address: "1400 Research Blvd, Austin, TX 78758",
    lat: 30.3891,
    lng: -97.7256,
    primaryType: "general_contractor",
    types: ["general_contractor", "point_of_interest", "establishment"],
    phone: "(512) 555-0199",
  },
  {
    id: "mock_place_subway",
    name: "Subway",
    address: "200 W 6th St, Austin, TX 78701",
    lat: 30.2685,
    lng: -97.7462,
    primaryType: "restaurant",
    types: ["restaurant", "food", "point_of_interest", "establishment"],
    phone: "(512) 555-0102",
  },
];

/** Case-insensitive substring match on name or address, mirroring how Places
 *  autocomplete ranks a typed query. Returns up to 5, like the live cap. */
export function mockAutocomplete(input: string): GoogleAutocompleteResponse {
  const q = input.trim().toLowerCase();
  const hits = MOCK_PLACES.filter(
    (p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
  ).slice(0, 5);
  return {
    suggestions: hits.map((p) => {
      const [main, ...rest] = p.address.split(",");
      const secondary = [main, ...rest].join(",").trim();
      return {
        placePrediction: {
          placeId: p.id,
          text: { text: `${p.name}, ${p.address}` },
          structuredFormat: {
            mainText: { text: p.name },
            secondaryText: { text: secondary },
          },
        },
      };
    }),
  };
}

/** Mock place-details lookup by id. Unknown ids resolve to an empty payload so
 *  the resolver's not-found path is exercisable too. */
export function mockPlaceDetails(placeId: string): GooglePlaceDetails {
  const p = MOCK_PLACES.find((m) => m.id === placeId);
  if (!p) return {};
  return {
    id: p.id,
    displayName: { text: p.name },
    formattedAddress: p.address,
    location: { latitude: p.lat, longitude: p.lng },
    primaryType: p.primaryType,
    types: p.types,
    nationalPhoneNumber: p.phone,
  };
}
