// Tests the Phase 2 prospect → Merchant pipeline:
//   - categoryFromPlaces: the Google-types keyword bucketing table
//   - prospectToMerchant: cold-lead defaults + field fallbacks
//   - useMerchants: origin-gating, discover_prospects wiring, empty list
//
// We stub @/lib/supabase (functions.invoke) so no network is hit, and
// @/stores/auth so getProfession has a user to read.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useMerchants,
  categoryFromPlaces,
  prospectToMerchant,
  type ProspectRow,
} from "./useMerchants";

// ── Mocks ──────────────────────────────────────────────────────────
const invokeMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: unknown) => unknown) =>
    selector({ user: { user_metadata: { profession: "merchant_services" } } }),
  getProfession: () => "merchant_services",
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeRow(overrides: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "p-1",
    place_id: "ChIJ_test",
    name: "Pat's Family Diner",
    category: "restaurant",
    address: "123 Congress Ave",
    lat: 30.2672,
    lng: -97.7431,
    phone: "+15125550100",
    website: "https://pats.example",
    employee_count: null,
    rating_count: 84,
    distance_m: 120,
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

// ── categoryFromPlaces ─────────────────────────────────────────────
describe("categoryFromPlaces", () => {
  it("buckets food-ish Google types into restaurant", () => {
    expect(categoryFromPlaces("barbecue_restaurant")).toBe("restaurant");
    expect(categoryFromPlaces("coffee_shop")).toBe("restaurant");
    expect(categoryFromPlaces("bakery")).toBe("restaurant");
  });
  it("buckets clinical types into healthcare", () => {
    expect(categoryFromPlaces("dentist")).toBe("healthcare");
    expect(categoryFromPlaces("veterinary_care")).toBe("healthcare");
  });
  it("buckets car types into automotive", () => {
    expect(categoryFromPlaces("car_repair")).toBe("automotive");
    expect(categoryFromPlaces("gas_station")).toBe("automotive");
  });
  it("buckets grooming/fitness into personal_services", () => {
    expect(categoryFromPlaces("hair_salon")).toBe("personal_services");
    expect(categoryFromPlaces("gym")).toBe("personal_services");
  });
  it("buckets lodging into hospitality", () => {
    expect(categoryFromPlaces("lodging")).toBe("hospitality");
    expect(categoryFromPlaces("motel")).toBe("hospitality");
  });
  it("buckets pro-services types into professional_services", () => {
    expect(categoryFromPlaces("lawyer")).toBe("professional_services");
    expect(categoryFromPlaces("plumber")).toBe("professional_services");
  });
  it("buckets shops into retail", () => {
    expect(categoryFromPlaces("clothing_store")).toBe("retail");
    expect(categoryFromPlaces("grocery_store")).toBe("retail");
  });
  it("falls back to other for unknown or empty input", () => {
    expect(categoryFromPlaces("zzz_unknown_type")).toBe("other");
    expect(categoryFromPlaces("")).toBe("other");
    expect(categoryFromPlaces(null)).toBe("other");
    expect(categoryFromPlaces(undefined)).toBe("other");
  });
  it("is case-insensitive and trims", () => {
    expect(categoryFromPlaces("  Hair_Salon  ")).toBe("personal_services");
  });
});

// ── prospectToMerchant ─────────────────────────────────────────────
describe("prospectToMerchant", () => {
  it("maps a row into an untouched Merchant with real coords", () => {
    const m = prospectToMerchant(makeRow());
    expect(m.id).toBe("p-1");
    expect(m.status).toBe("untouched");
    expect(m.lastActivity).toBeNull();
    expect(m.lat).toBe(30.2672);
    expect(m.lng).toBe(-97.7431);
    expect(m.placeId).toBe("ChIJ_test");
    expect(m.website).toBe("https://pats.example");
    expect(m.ratingCount).toBe(84);
    expect(m.employeeCountRange).toBe("");
  });
  it("falls back to a placeholder address when missing", () => {
    expect(prospectToMerchant(makeRow({ address: null })).address).toBe("Address unavailable");
  });
  it("uses an empty phone string when Places gives none", () => {
    expect(prospectToMerchant(makeRow({ phone: null })).phone).toBe("");
  });
  it("leaves website/ratingCount undefined when absent", () => {
    const m = prospectToMerchant(makeRow({ website: null, rating_count: null }));
    expect(m.website).toBeUndefined();
    expect(m.ratingCount).toBeUndefined();
  });
});

// ── useMerchants ───────────────────────────────────────────────────
describe("useMerchants", () => {
  it("does not fetch while origin is null (geolocation settling)", () => {
    const { result } = renderHook(() => useMerchants(null), { wrapper });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.current.merchants).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("calls discover_prospects and maps the returned prospects", async () => {
    invokeMock.mockResolvedValue({
      data: { prospects: [makeRow({ id: "a" }), makeRow({ id: "b", name: "Hilltop BBQ" })] },
      error: null,
    });
    const { result } = renderHook(
      () => useMerchants({ lat: 30.2672, lng: -97.7431 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.merchants).toHaveLength(2));
    expect(invokeMock).toHaveBeenCalledWith("discover_prospects", {
      body: { lat: 30.2672, lng: -97.7431, radius_m: 3000, profession: "merchant_services" },
    });
    expect(result.current.merchants.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result.current.merchants[0]!.status).toBe("untouched");
  });

  it("returns an empty list when the function returns no prospects", async () => {
    invokeMock.mockResolvedValue({ data: { prospects: [] }, error: null });
    const { result } = renderHook(
      () => useMerchants({ lat: 30.2672, lng: -97.7431 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.merchants).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it("surfaces an error when the function call fails", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const { result } = renderHook(
      () => useMerchants({ lat: 30.2672, lng: -97.7431 }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.merchants).toEqual([]);
  });

  it("honors a custom radius", async () => {
    invokeMock.mockResolvedValue({ data: { prospects: [] }, error: null });
    renderHook(() => useMerchants({ lat: 30.2672, lng: -97.7431 }, { radiusM: 1500 }), {
      wrapper,
    });
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith("discover_prospects", {
      body: { lat: 30.2672, lng: -97.7431, radius_m: 1500, profession: "merchant_services" },
    });
  });
});
