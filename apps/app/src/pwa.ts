/**
 * Service-worker registration + update-detection wiring.
 *
 * vite-plugin-pwa exposes the `virtual:pwa-register` module that bundles the
 * registration code at build time. We pull it in here, hook the lifecycle
 * callbacks to console for now, and re-export `updateSW(reloadPage)` so the
 * eventual toast UI can call it on the user's "Refresh" click.
 *
 * Boot order is important: this module is imported from `main.tsx` *after*
 * `index.css` and `stores/theme` so the page renders first and the SW
 * registers from idle. We don't `await` registration.
 *
 * Dev note: in `pnpm dev`, vite-plugin-pwa is configured with no
 * `devOptions.enabled`, so this module imports cleanly but the virtual
 * registration call is a no-op until you run `pnpm --filter app build` and
 * `pnpm --filter app preview`.
 */

import { registerSW } from "virtual:pwa-register";

let pendingUpdate = false;

/**
 * Wraps the auto-generated `registerSW`. Reloads the page when called with
 * `true` after a new SW is waiting, otherwise just logs.
 */
export const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    pendingUpdate = true;
    // TODO Session 4+: replace with toast UI ("Refresh to update").
    console.info(
      "%c[pwa]%c new content available — call updateSW(true) to apply",
      "color:#2F5BFF;font-weight:600",
      "color:inherit",
    );
  },
  onOfflineReady() {
    console.info(
      "%c[pwa]%c ready to work offline",
      "color:#10b981;font-weight:600",
      "color:inherit",
    );
  },
  onRegisteredSW(swUrl) {
    console.info(
      "%c[pwa]%c service worker registered",
      "color:#2F5BFF;font-weight:600",
      "color:inherit",
      swUrl,
    );
  },
  onRegisterError(error) {
    console.error("[pwa] service worker registration failed:", error);
  },
});

/** Whether an update is queued (a new SW is waiting). */
export function isUpdatePending(): boolean {
  return pendingUpdate;
}
