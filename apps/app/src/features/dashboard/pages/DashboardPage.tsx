import { Compass, LogOut, Sun, Moon, Monitor } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/navigatr";
import { useAuth, getProfession } from "@/stores/auth";
import { useTheme, type Theme } from "@/stores/theme";

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

/**
 * Placeholder dashboard — the real rep / manager / executive views land in
 * Session 11. Today this just confirms the auth round-trip works:
 *   - shows the signed-in user + tenant profession
 *   - exposes a Sign Out button
 *   - keeps the theme cycle for sanity
 */
export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  const profession = getProfession(user);
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "—";

  const onSignOut = async () => {
    try {
      await signOut();
      toast.success("Signed out.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sign out");
    }
  };

  return (
    <main className="flex min-h-dvh flex-col bg-surface-canvas">
      {/* Minimal top bar — the real TopBar component lands later */}
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface-default px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-radius-md bg-brand-primary text-brand-primary-foreground">
            <Compass className="h-4 w-4" />
          </span>
          <span className="text-heading-sm tracking-tight text-text-default">navigatr</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Theme toggle: tertiary variant overridden to text-default since
              this isn't a primary action. When the canonical TopBar component
              lands in Session 11 the placeholder goes away. */}
          <Button
            variant="tertiary"
            size="sm"
            leadingIcon={ThemeIcon}
            onClick={() => setTheme(NEXT_THEME[theme])}
            className="text-text-muted hover:text-text-default"
          >
            {THEME_LABEL[theme]}
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={LogOut} onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl rounded-radius-lg border border-border-subtle bg-surface-elevated p-8 shadow-sm">
          <p className="text-eyebrow text-text-subtle">Coming in Session 11</p>
          <h1 className="mt-1 text-heading-lg text-text-default">Dashboard — placeholder.</h1>
          <p className="mt-2 text-body-md text-text-muted">
            You're signed in. The auth round-trip works. The real rep / manager / executive
            dashboards land in Session 11 with KPI rows, alerts, and recent activity.
          </p>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-radius-md border border-border-subtle bg-surface-sunken p-4">
              <dt className="text-eyebrow text-text-subtle">Signed in as</dt>
              <dd className="mt-1 text-body-strong text-text-default">{fullName}</dd>
              <dd className="text-caption text-text-muted">{user?.email}</dd>
            </div>
            <div className="rounded-radius-md border border-border-subtle bg-surface-sunken p-4">
              <dt className="text-eyebrow text-text-subtle">Profession</dt>
              <dd className="mt-1 text-body-strong text-text-default">
                {profession ? profession.replace(/_/g, " ") : "—"}
              </dd>
              <dd className="text-caption text-text-muted">stored in user_metadata</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
