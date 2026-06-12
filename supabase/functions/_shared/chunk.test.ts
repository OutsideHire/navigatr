import { describe, it, expect } from "vitest";
import { chunk, dedupeById } from "./chunk";

describe("chunk", () => {
  it("returns a single batch when within the size", () => {
    expect(chunk([1, 2, 3], 50)).toEqual([[1, 2, 3]]);
  });
  it("splits 167 into [50, 50, 50, 17] with order preserved and no loss", () => {
    const arr = Array.from({ length: 167 }, (_, i) => i);
    const batches = chunk(arr, 50);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 50, 17]);
    expect(batches.flat()).toEqual(arr);
  });
  it("yields a single empty batch for an empty array", () => {
    expect(chunk([], 50)).toEqual([[]]);
  });
  it("throws on a size below 1", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("dedupeById", () => {
  it("dedupes by id (last-writer-wins) and drops id-less entries", () => {
    const out = dedupeById([
      { id: "a", n: 1 },
      { id: "b", n: 2 },
      { id: "a", n: 3 },
      { id: null, n: 4 },
      { n: 5 } as { id?: string | null; n: number },
    ]);
    expect(out).toEqual([{ id: "a", n: 3 }, { id: "b", n: 2 }]);
  });
  it("returns an empty array for empty input", () => {
    expect(dedupeById([])).toEqual([]);
  });
});
