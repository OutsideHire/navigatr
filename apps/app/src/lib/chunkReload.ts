/**
 * installChunkReloadHandler — recover from stale-chunk load failures.
 *
 * Every route is `React.lazy`, so its JS is a content-hashed chunk. After a
 * deploy the old hashed chunks are purged, so a long-lived session that then
 * navigates to a not-yet-loaded route requests a chunk that 404s and the page
 * goes blank. Vite dispatches a `vite:preloadError` event for exactly this; we
 * reload once to pull the new build. A short cooldown prevents a reload loop
 * when the reload itself can't recover (e.g. genuinely offline). This pairs
 * with the app's auto-update (pwa.ts): most sessions update on visibility
 * change, and this catches the ones that navigate to a purged chunk first.
 */

const COOLDOWN_MS = 10_000;
const STORAGE_KEY = "chunk-reload-at";

export interface ChunkReloadDeps {
  target?: EventTarget;
  reload?: () => void;
  now?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem">;
}

export function installChunkReloadHandler(deps: ChunkReloadDeps = {}): void {
  const target = deps.target ?? (typeof window !== "undefined" ? window : undefined);
  if (!target) return;
  const reload = deps.reload ?? (() => window.location.reload());
  const now = deps.now ?? (() => Date.now());
  const storage = deps.storage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);

  target.addEventListener("vite:preloadError", () => {
    let last = 0;
    try { last = Number(storage?.getItem(STORAGE_KEY) ?? 0) || 0; } catch { /* storage blocked */ }
    // Don't loop: if we already reloaded moments ago and it still failed, stop.
    // last === 0 means we've never reloaded, so always allow the first one.
    if (last !== 0 && now() - last < COOLDOWN_MS) return;
    try { storage?.setItem(STORAGE_KEY, String(now())); } catch { /* ignore */ }
    reload();
  });
}
