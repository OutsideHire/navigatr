/**
 * Service-worker registration + update UX.
 *
 * vite-plugin-pwa is configured `registerType: "prompt"` (the new SW waits), so when
 * a deploy is detected we show a sonner "Refresh" toast; tapping it calls
 * updateSW(true), which skip-waits the new SW and reloads. We also poll for updates
 * hourly so long-lived sessions still get prompted. Imported once from main.tsx.
 *
 * Dev note: in `pnpm dev` (no devOptions.enabled) the virtual registration is a
 * no-op until `pnpm --filter app build` + `preview`.
 */
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

/** Poll interval for a newer deployed SW (long-lived sessions). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

let pendingUpdate = false;

// `let` (not `const`) so onNeedRefresh — invoked later, once a waiting SW exists —
// can call the assigned updateSW. registerSW only stores the callbacks at call time.
let updateSW: (reloadPage?: boolean) => Promise<void>;

updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    pendingUpdate = true;
    toast("New version available", {
      description: "Refresh to get the latest.",
      duration: Infinity,
      action: { label: "Refresh", onClick: () => { void updateSW(true); } },
    });
  },
  onOfflineReady() {
    console.info("%c[pwa]%c ready to work offline", "color:#10b981;font-weight:600", "color:inherit");
  },
  onRegisteredSW(swUrl, registration) {
    console.info("%c[pwa]%c service worker registered", "color:#2456E6;font-weight:600", "color:inherit", swUrl);
    if (registration) {
      setInterval(() => { void registration.update(); }, UPDATE_CHECK_MS);
    }
  },
  onRegisterError(error) {
    console.error("[pwa] service worker registration failed:", error);
  },
});

export { updateSW };

/** Whether a new SW is waiting (a Refresh toast is showing). */
export function isUpdatePending(): boolean {
  return pendingUpdate;
}
