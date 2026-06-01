// Mock Google Places (New) searchNearby response for PLACES_MOCK=1.
//
// Lets us exercise the whole ingest pipeline (classify → store → query) with
// zero API cost and no dependency on a live Places key. The shape mirrors the
// real Places API New response (places[].displayName.text, types, location,
// etc.) so swapping to the live call is a drop-in.
//
// The set is hand-picked to hit every ICP branch:
//   - a clean independent SMB (kept)
//   - a seed-list chain, Subway (filtered: seed_list)
//   - a consumer-only place, a hotel (filtered: category / out of profile)
//   - an institutional place, a hospital (filtered: gov)
//   - two more clean SMBs so a path has something to show

export interface PlacesNewPlace {
  id: string;
  displayName: { text: string };
  types: string[];
  location: { latitude: number; longitude: number };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  userRatingCount?: number;
  rating?: number;
}

export interface PlacesNewResponse {
  places: PlacesNewPlace[];
}

/** Jitter a base coordinate by a few hundred meters for realistic spread. */
function near(base: number, meters: number): number {
  // ~111_111 m per degree latitude; good enough for fixtures.
  return base + meters / 111_111;
}

export function mockSearchNearby(lat: number, lng: number): PlacesNewResponse {
  return {
    places: [
      {
        id: "mock_diner_1",
        displayName: { text: "Pat's Family Diner" },
        types: ["restaurant", "food", "point_of_interest", "establishment"],
        location: { latitude: near(lat, 120), longitude: near(lng, 80) },
        formattedAddress: "101 Congress Ave, Austin, TX",
        nationalPhoneNumber: "(512) 555-0101",
        websiteUri: "https://patsdiner.example",
        userRatingCount: 84,
        rating: 4.6,
      },
      {
        id: "mock_subway_1",
        displayName: { text: "Subway #4471" },
        types: ["restaurant", "food", "point_of_interest", "establishment"],
        location: { latitude: near(lat, 200), longitude: near(lng, -150) },
        formattedAddress: "200 W 6th St, Austin, TX",
        nationalPhoneNumber: "(512) 555-0102",
        userRatingCount: 30,
        rating: 3.9,
      },
      {
        id: "mock_hotel_1",
        displayName: { text: "Downtown Grand Hotel" },
        types: ["lodging", "point_of_interest", "establishment"],
        location: { latitude: near(lat, -90), longitude: near(lng, 210) },
        formattedAddress: "300 Brazos St, Austin, TX",
        userRatingCount: 1200,
        rating: 4.4,
      },
      {
        id: "mock_hospital_1",
        displayName: { text: "Central Austin Hospital" },
        types: ["hospital", "health", "point_of_interest", "establishment"],
        location: { latitude: near(lat, 300), longitude: near(lng, 300) },
        formattedAddress: "400 E 15th St, Austin, TX",
        userRatingCount: 540,
        rating: 3.2,
      },
      {
        id: "mock_dental_1",
        displayName: { text: "Riverside Dental Group" },
        types: ["dentist", "health", "point_of_interest", "establishment"],
        location: { latitude: near(lat, -160), longitude: near(lng, -60) },
        formattedAddress: "512 Riverside Dr, Austin, TX",
        nationalPhoneNumber: "(512) 555-0105",
        websiteUri: "https://riversidedental.example",
        userRatingCount: 210,
        rating: 4.8,
      },
      {
        id: "mock_hvac_1",
        displayName: { text: "Lone Star HVAC Services" },
        types: ["general_contractor", "point_of_interest", "establishment"],
        location: { latitude: near(lat, 250), longitude: near(lng, -240) },
        formattedAddress: "900 Industrial Blvd, Austin, TX",
        nationalPhoneNumber: "(512) 555-0106",
        userRatingCount: 47,
        rating: 4.1,
      },
    ],
  };
}
