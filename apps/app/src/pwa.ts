/**
 * Service-worker registration + update UX.
 *
 * vite-plugin-pwa is configured `registerType: "prompt"` (the new SW waits), so when
 * a deploy is detected we show a sonner "Refresh" toast; tapping it calls
 * updateSW(true), which skip-waits the new SW and reloads. We keep the prompt model
 * (no surprise reloads) but make it reliable: we check for a newer SW on tab focus
 * (visibilitychange) — not just the hourly poll — and re-surface the Refresh toast
 * if a pending update was dismissed. Imported once from main.tsx.
 *
 * Dev note: in `pnpm dev` (no devOptions.enabled) the virtual registration is a
 * no-op until `pnpm --filter app build` + `preview`.
 */
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

/** Poll interval for a newer deployed SW (long-lived sessions). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** Stable toast id so re-showing the prompt replaces it instead of stacking. */
const UPDATE_TOAST_ID = "pwa-update";

let pendingUpdate = false;
let registration: ServiceWorkerRegistration | undefined;

// `let` (not `const`) so onNeedRefresh — invoked later, once a waiting SW exists —
// can call the assigned updateSW. registerSW only stores the callbacks at call time.
let updateSW: (reloadPage?: boolean) => Promise<void>;

function showRefreshToast() {
  toast("New version available", {
    id: UPDATE_TOAST_ID,
    description: "Refresh to get the latest.",
    duration: Infinity,
    action: { label: "Refresh", onClick: () => { void updateSW(true); } },
  });
}

updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    pendingUpdate = true;
    showRefreshToast();
  },
  onOfflineReady() {
    console.info("%c[pwa]%c ready to work offline", "color:#10b981;font-weight:600", "color:inherit");
  },
  onRegisteredSW(swUrl, reg) {
    console.info("%c[pwa]%c service worker registered", "color:#2456E6;font-weight:600", "color:inherit", swUrl);
    registration = reg;
    if (reg) {
      setInterval(() => { void reg.update(); }, UPDATE_CHECK_MS);
    }
  },
  onRegisterError(error) {
    console.error("[pwa] service worker registration failed:", error);
  },
});

// Returning to the tab is the moment to catch a fresh deploy: check for a newer SW
// immediately (much faster than the hourly poll) and re-show the Refresh prompt if a
// pending update was dismissed.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void registration?.update();
    if (pendingUpdate) showRefreshToast();
  });
}

export { updateSW };

/** Whether a new SW is waiting (a Refresh toast is showing). */
export function isUpdatePending(): boolean {
  return pendingUpdate;
}
