/**
 * Install-prompt store — captures the browser's `beforeinstallprompt` event
 * so the UI can show a tailored "Install navigatr" button at the right
 * moment instead of letting the browser's built-in install UI fire on its
 * own (which gets dismissed silently and never reappears).
 *
 * Flow:
 *   1. Browser fires `beforeinstallprompt` when the page first becomes
 *      installable (Chrome/Edge/Android Chrome). We `preventDefault()` so
 *      the browser doesn't show its own banner, and stash the event.
 *   2. UI reads `isInstallable` and renders the "Install navigatr" button.
 *   3. On click, `promptInstall()` calls `.prompt()` on the stashed event
 *      and resolves with the user's choice.
 *   4. If the user installs, `appinstalled` fires and we flip
 *      `hasInstalled` (persisted) so we never re-prompt.
 *
 * iOS Safari does NOT fire `beforeinstallprompt`. iOS installation is a
 * manual "Add to Home Screen" gesture from the Share sheet — see the
 * README for instructions surfaced to the user. We detect already-installed
 * iOS PWAs via the standalone display-mode media query and the legacy
 * `navigator.standalone` flag.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * `beforeinstallprompt` is a non-standard event; TypeScript's lib.dom doesn't
 * include it. This narrow interface is enough for the call sites.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

interface InstallState {
  /** True while a `beforeinstallprompt` event is queued and ready to fire. */
  isInstallable: boolean;
  /** True once the user has installed (persisted to localStorage). */
  hasInstalled: boolean;
  /** Underlying browser event — not serializable, not persisted. */
  _deferredPrompt: BeforeInstallPromptEvent | null;

  _setDeferredPrompt: (e: BeforeInstallPromptEvent | null) => void;
  _setHasInstalled: (value: boolean) => void;

  /**
   * Trigger the native install prompt. Returns the user's choice, or
   * `"unavailable"` if no prompt is queued (e.g. iOS Safari, or the user
   * already dismissed it in this session).
   */
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

export const useInstall = create<InstallState>()(
  persist(
    (set, get) => ({
      isInstallable: false,
      hasInstalled: false,
      _deferredPrompt: null,

      _setDeferredPrompt: (e) => set({ _deferredPrompt: e, isInstallable: !!e }),
      _setHasInstalled: (v) => set({ hasInstalled: v }),

      promptInstall: async () => {
        const e = get()._deferredPrompt;
        if (!e) return "unavailable";

        try {
          await e.prompt();
          const { outcome } = await e.userChoice;
          // The event can only be used once.
          set({ _deferredPrompt: null, isInstallable: false });
          if (outcome === "accepted") set({ hasInstalled: true });
          return outcome;
        } catch (err) {
          console.warn("[install] prompt failed:", err);
          set({ _deferredPrompt: null, isInstallable: false });
          return "dismissed";
        }
      },
    }),
    {
      name: "navigatr-install",
      storage: createJSONStorage(() => localStorage),
      // Only persist the "have they installed" flag; the deferred event is
      // a runtime browser object and can't be revived from JSON.
      partialize: (s) => ({ hasInstalled: s.hasInstalled }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Module-level side effects: wire browser events to the store, once.
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress the browser's own banner so we control the UX entirely.
    event.preventDefault();
    useInstall.getState()._setDeferredPrompt(event as BeforeInstallPromptEvent);
  });

  window.addEventListener("appinstalled", () => {
    useInstall.getState()._setHasInstalled(true);
    useInstall.getState()._setDeferredPrompt(null);
  });

  // Detect "already running as installed PWA" — covers iOS (no
  // beforeinstallprompt) and the case where the user installed from a
  // different browser surface.
  type IosNavigator = Navigator & { standalone?: boolean };
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as IosNavigator).standalone === true;
  if (isStandalone) {
    useInstall.getState()._setHasInstalled(true);
  }
}
