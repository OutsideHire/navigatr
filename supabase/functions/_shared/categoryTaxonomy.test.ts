// Tests the category taxonomy that drives both ingest targeting and display
// bucketing (PATH_DESIGN.md §11).
//
// We can't reach Google's live Table A from a unit test, so we guard the two
// things that break the ingest call at runtime:
//   - every type is a valid-LOOKING Table A value (lowercase snake_case)
//   - no type appears in two buckets (keeps bucketForType deterministic)
// plus the bucketForType mapping behaviour the app + Edge both rely on.

import { describe, it, expect } from "vitest";
import {
  CATEGORY_TYPES,
  CATEGORY_BUCKETS,
  bucketForType,
  type CategoryBucket,
} from "./categoryTaxonomy";

const EXPECTED_BUCKETS: CategoryBucket[] = [
  "restaurant",
  "retail",
  "automotive",
  "healthcare",
  "personal_services",
  "professional_services",
  "hospitality",
];

describe("CATEGORY_TYPES shape", () => {
  it("has exactly the 7 ICP buckets", () => {
    expect(CATEGORY_BUCKETS.sort()).toEqual([...EXPECTED_BUCKETS].sort());
  });

  it("every type is lowercase snake_case (valid Table A shape)", () => {
    const re = /^[a-z]+(?:_[a-z0-9]+)*$/;
    for (const bucket of CATEGORY_BUCKETS) {
      for (const t of CATEGORY_TYPES[bucket]) {
        expect(t, `${bucket} → "${t}"`).toMatch(re);
      }
    }
  });

  it("no type appears in more than one bucket", () => {
    const seen = new Map<string, CategoryBucket>();
    for (const bucket of CATEGORY_BUCKETS) {
      for (const t of CATEGORY_TYPES[bucket]) {
        expect(seen.has(t), `"${t}" in both ${seen.get(t)} and ${bucket}`).toBe(false);
        seen.set(t, bucket);
      }
    }
  });

  it("no bucket exceeds Google's 50-includedTypes-per-call ceiling", () => {
    for (const bucket of CATEGORY_BUCKETS) {
      expect(CATEGORY_TYPES[bucket].length, bucket).toBeLessThanOrEqual(50);
    }
  });

  it("every bucket has at least one type", () => {
    for (const bucket of CATEGORY_BUCKETS) {
      expect(CATEGORY_TYPES[bucket].length, bucket).toBeGreaterThan(0);
    }
  });
});

describe("bucketForType", () => {
  it("maps each declared type back to its own bucket", () => {
    for (const bucket of CATEGORY_BUCKETS) {
      for (const t of CATEGORY_TYPES[bucket]) {
        expect(bucketForType([t]), t).toBe(bucket);
      }
    }
  });

  it("fixes the barber_shop → restaurant substring bug", () => {
    // The old substring matcher bucketed "barber_shop" as restaurant because
    // "bar" is a substring. Exact-type lookup puts it in personal_services.
    expect(bucketForType(["barber_shop"])).toBe("personal_services");
  });

  it("buckets service businesses the old popularity pull starved", () => {
    expect(bucketForType(["general_contractor"])).toBe("professional_services");
    expect(bucketForType(["moving_company"])).toBe("professional_services");
    expect(bucketForType(["locksmith"])).toBe("professional_services");
    expect(bucketForType(["veterinary_care"])).toBe("healthcare");
    expect(bucketForType(["bed_and_breakfast"])).toBe("hospitality");
  });

  it("returns the first recognised type, ignoring Google's generic noise", () => {
    expect(
      bucketForType(["dentist", "health", "point_of_interest", "establishment"]),
    ).toBe("healthcare");
  });

  it("is case-insensitive and trims", () => {
    expect(bucketForType(["  Hair_Salon  "])).toBe("personal_services");
  });

  it("falls back to other for unknown, empty, or nullish input", () => {
    expect(bucketForType(["zzz_unknown_type"])).toBe("other");
    expect(bucketForType([])).toBe("other");
    expect(bucketForType(null)).toBe("other");
    expect(bucketForType(undefined)).toBe("other");
    expect(bucketForType(["", "point_of_interest"])).toBe("other");
  });
});
