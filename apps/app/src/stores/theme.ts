/**
 * Theme store — light / dark / system, persisted to localStorage.
 *
 * The store both:
 *   1. Tracks the user's *preference* (`theme`), which can be "system"
 *   2. Tracks the *applied* mode (`resolvedTheme`), always "light" or "dark"
 *
 * On load, the module-level `applyInitialTheme()` block runs synchronously
 * so the `<html class="dark">` is set before React mounts — no FOUC.
 *
 * When `theme === "system"`, we listen to `prefers-color-scheme` and
 * re-apply on change.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

function getSystemPreference(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemPreference() : theme;
}

function applyToDocument(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "system",
      resolvedTheme: getSystemPreference(),
      setTheme: (theme) => {
        const resolved = resolveTheme(theme);
        applyToDocument(resolved);
        set({ theme, resolvedTheme: resolved });
      },
    }),
    {
      name: "navigatr-theme",
      storage: createJSONStorage(() => localStorage),
      // Only persist the user's preference, not the derived resolved value.
      partialize: (state) => ({ theme: state.theme }),
      onRehydrateStorage: () => (state) => {
        // After localStorage rehydrates, recompute and apply.
        if (state) {
          const resolved = resolveTheme(state.theme);
          applyToDocument(resolved);
          state.resolvedTheme = resolved;
        }
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Module-level side effects: run once on import.
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // 1) Apply theme synchronously on first import so the rest of the bundle
  //    paints with the right class on <html>. We read localStorage directly
  //    here (without going through Zustand) because the store's persist
  //    middleware rehydrates asynchronously on first render.
  let initial: Theme = "system";
  try {
    const raw = window.localStorage.getItem("navigatr-theme");
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { theme?: Theme } };
      if (parsed?.state?.theme === "light" || parsed?.state?.theme === "dark" || parsed?.state?.theme === "system") {
        initial = parsed.state.theme;
      }
    }
  } catch {
    // Malformed localStorage — fall back to "system".
  }
  applyToDocument(resolveTheme(initial));

  // 2) Live-update when the OS theme changes, but only while user is on
  //    "system". Manual light/dark choices stay sticky.
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    const { theme, setTheme } = useTheme.getState();
    if (theme === "system") {
      setTheme("system"); // triggers re-resolve + re-apply
    }
  });
}
