/**
 * Service-worker registration + update behavior.
 *
 * vite-plugin-pwa is configured `registerType: "prompt"` (the new SW waits), which
 * hands us control over WHEN a published update is applied. We apply it
 * AUTOMATICALLY, but only at a moment that can't interrupt the user:
 *
 *   - detected while the app is backgrounded  -> apply now (invisible reload)
 *   - detected while the app is in foreground  -> wait, then apply on the next
 *     visibility change (backgrounding = silent; reopening = a reload before the
 *     user interacts). We never reload mid-interaction, so unsaved input in a
 *     note or form is safe.
 *
 * On mobile the app is backgrounded constantly, so an update lands within
 * seconds either way. We also poll hourly and re-check on tab focus so a fresh
 * deploy is noticed promptly in long-lived sessions. Imported once from main.tsx.
 *
 * Applying = updateSW(true): skip-waits the waiting SW and reloads to the new
 * bundle. Dev note: in `pnpm dev` (no devOptions.enabled) the virtual
 * registration is a no-op until `pnpm --filter app build` + `preview`.
 */
import { registerSW } from "virtual:pwa-register";

/** Poll interval for a newer deployed SW (long-lived sessions). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

let pendingUpdate = false;
let registration: ServiceWorkerRegistration | undefined;

// `let` (not `const`) so the callbacks — invoked later, once a waiting SW exists —
// can call the assigned updateSW. registerSW only stores the callbacks at call time.
let updateSW: (reloadPage?: boolean) => Promise<void>;

function appHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** True on the OAuth/magic-link handoff routes (/auth/callback etc.). A
 *  skip-waiting reload here would re-run the app mid-PKCE-exchange and can drop
 *  the session, exactly the mobile-logout failure mode. Pure + exported so the
 *  guard is unit-testable. */
export function isAuthHandoffPath(pathname: string): boolean {
  return pathname.startsWith("/auth/");
}

/**
 * Ask the browser to re-check for a new service worker, and swallow everything
 * that comes back. Two separate hazards, both of which we have actually met:
 *
 *  1. A REJECTED update. The script fetch fails (a rep losing signal at the
 *     moment the tab came back to the foreground) and the browser rejects with
 *     a TypeError. That is a non-event, since the next visibility change or the
 *     hourly poll re-checks anyway, but unhandled it becomes a global error.
 *     errorFilter does drop it by message, except the wording is Chromium's:
 *     other engines phrase it differently and slip past the matcher. Catching
 *     at the source kills the class however a browser chooses to word it.
 *
 *  2. An `update()` that does not return a promise. This runs inside the
 *     visibilitychange listener, so a synchronous throw here would skip
 *     applyUpdate() below it and a pending deploy would never land. Suppressing
 *     log noise must not be able to break the update mechanism it decorates.
 */
function checkForUpdate(reg: ServiceWorkerRegistration | undefined): void {
  if (!reg) return;
  try {
    void Promise.resolve(reg.update()).catch(() => {});
  } catch {
    /* an update CHECK must never be able to break its caller */
  }
}

/** Apply a waiting update: skip-waiting + reload to the new bundle. The reload
 *  wipes module state in the browser; the guard also stops a delayed reload from
 *  firing twice. Never reloads during an auth handoff; the update stays pending
 *  and applies at the next safe moment once the user is off /auth. */
function applyUpdate() {
  if (!pendingUpdate) return;
  if (typeof window !== "undefined" && isAuthHandoffPath(window.location.pathname)) return;
  pendingUpdate = false;
  void updateSW(true);
}

updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    pendingUpdate = true;
    // Apply now only if the user isn't looking. In the foreground we defer to the
    // next visibility change so a reload never lands mid-interaction.
    if (appHidden()) applyUpdate();
  },
  onOfflineReady() {
    console.info("%c[pwa]%c ready to work offline", "color:#10b981;font-weight:600", "color:inherit");
  },
  onRegisteredSW(swUrl, reg) {
    console.info("%c[pwa]%c service worker registered", "color:#2456E6;font-weight:600", "color:inherit", swUrl);
    registration = reg;
    if (reg) {
      setInterval(() => checkForUpdate(reg), UPDATE_CHECK_MS);
    }
  },
  onRegisterError(error) {
    console.error("[pwa] service worker registration failed:", error);
  },
});

// A visibility change is the safe moment to apply a pending update: backgrounding
// applies it invisibly; returning checks for a fresh deploy and applies a waiting
// one before the user starts interacting.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkForUpdate(registration);
    }
    applyUpdate();
  });
}

export { updateSW };
