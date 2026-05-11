import { Compass, Sun, Moon, Monitor, Download } from "lucide-react";
import { useTheme, type Theme } from "@/stores/theme";
import { useInstall } from "@/stores/install";

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const THEME_LABEL: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function App() {
  const theme = useTheme((s) => s.theme);
  const resolvedTheme = useTheme((s) => s.resolvedTheme);
  const setTheme = useTheme((s) => s.setTheme);

  const isInstallable = useInstall((s) => s.isInstallable);
  const hasInstalled = useInstall((s) => s.hasInstalled);
  const promptInstall = useInstall((s) => s.promptInstall);

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const showInstall = isInstallable && !hasInstalled;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-canvas px-4 py-8">
      <div className="relative w-full max-w-md rounded-radius-lg border border-border-subtle bg-surface-elevated p-6 shadow-sm">
        {/* Install button — top-right, only when installable and not yet installed */}
        {showInstall && (
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-radius-full bg-brand-primary px-3 py-1.5 text-caption font-semibold text-brand-primary-foreground shadow-sm transition-colors hover:bg-brand-primary-hover active:bg-brand-primary-pressed"
          >
            <Download className="h-3.5 w-3.5" />
            Install navigatr
          </button>
        )}

        {/* Brand mark + wordmark */}
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-radius-md bg-brand-primary text-brand-primary-foreground">
            <Compass className="h-5 w-5" />
          </span>
          <span className="text-heading-md tracking-tight text-text-default">navigatr</span>
        </div>

        {/* Eyebrow + heading + body */}
        <p className="text-eyebrow text-text-subtle">Session 3 · PWA wired</p>
        <h1 className="mt-1 text-heading-lg text-text-default">Installable. Offline-capable.</h1>
        <p className="mt-2 text-body-md text-text-muted">
          Service worker registers on built/preview output. Add to home screen on iOS via Share →
          Add to Home Screen; Chrome/Edge surface the install button automatically.
        </p>

        {/* Status badges */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span
            className={
              hasInstalled
                ? "rounded-radius-sm bg-status-success-bg px-2 py-0.5 text-caption font-medium text-status-success"
                : "rounded-radius-sm bg-status-info-bg px-2 py-0.5 text-caption font-medium text-status-info"
            }
          >
            {hasInstalled ? "Installed" : "Not installed"}
          </span>
          <span
            className={
              isInstallable
                ? "rounded-radius-sm bg-accent-teal-20 px-2 py-0.5 text-caption font-medium text-accent-teal"
                : "rounded-radius-sm bg-surface-sunken px-2 py-0.5 text-caption font-medium text-text-subtle"
            }
          >
            {isInstallable ? "Install prompt ready" : "No install prompt"}
          </span>
        </div>

        {/* KPI demo — verifies kpi-md size + tabular figures */}
        <div className="mt-6 rounded-radius-md border border-border-subtle bg-surface-sunken px-4 py-3">
          <p className="text-eyebrow text-text-subtle">Total Pipeline</p>
          <p className="mt-1 text-kpi-md text-text-default">$1,284,500</p>
        </div>

        {/* Theme controls */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setTheme(NEXT_THEME[theme])}
            className="inline-flex items-center gap-2 rounded-radius-md bg-brand-primary px-4 py-2 text-body-strong text-brand-primary-foreground transition-colors hover:bg-brand-primary-hover active:bg-brand-primary-pressed"
          >
            <ThemeIcon className="h-4 w-4" />
            <span>Theme: {THEME_LABEL[theme]}</span>
          </button>
          <span className="text-caption text-text-subtle">
            applied: <span className="font-mono text-text-muted">{resolvedTheme}</span>
          </span>
        </div>

        {/* Gradient strip — verifies brand-gradient-from/via/to utilities */}
        <div className="mt-6 h-2 rounded-radius-full bg-gradient-to-r from-brand-gradient-from via-brand-gradient-via to-brand-gradient-to" />
      </div>
    </main>
  );
}
