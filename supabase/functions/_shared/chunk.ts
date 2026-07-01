// Small pure array helpers shared by the Edge (Deno) and unit-tested by vitest.
// Deno-free so the app's test runner can cover them; the Edge imports with `.ts`.

/** Split `arr` into batches of at most `size` (order preserved). Used to keep a
 *  bucket's includedTypes under Google searchNearby's 50-type-per-request cap
 *  (restaurants_bars_entertainment has ~200). An empty input yields a single empty batch. */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  if (arr.length <= size) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Dedupe by `id` (last-writer-wins), dropping entries without a truthy id. Used
 *  to merge chunked searchNearby results that may overlap across type batches. */
export function dedupeById<T extends { id?: string | null }>(items: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (item.id) byId.set(item.id, item);
  }
  return [...byId.values()];
}
