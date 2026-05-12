import { Home } from "lucide-react";
import { useAuth, getProfession } from "@/stores/auth";
import { Card } from "@/components/navigatr";

/**
 * Placeholder Dashboard — now wrapped by AppLayout (Session 10). The real
 * rep / manager / executive dashboards land in Session 11.
 *
 * Kept the auth-context card so we have a quick smoke-test that the
 * authenticated session is wired correctly. The TopBar avatar menu owns
 * sign out + theme toggle now — no need for the standalone top bar this
 * page used to render.
 */
export function DashboardPage() {
  const user = useAuth((s) => s.user);
  const profession = getProfession(user);
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? "—";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-radius-md bg-brand-primary-10 text-brand-primary">
          <Home className="h-5 w-5" />
        </span>
        <div>
          <p className="text-eyebrow text-text-subtle">Placeholder</p>
          <h1 className="text-heading-xl text-text-default">Dashboard</h1>
        </div>
      </div>

      <Card padding="xl" shadow="sm">
        <p className="text-eyebrow text-text-subtle">Coming in Session 11</p>
        <h2 className="mt-1 text-heading-md text-text-default">
          Rep / Manager / Executive dashboard variants.
        </h2>
        <p className="mt-3 max-w-2xl text-body-md text-text-muted">
          Today's Tasks · KPI row (Activities-to-Win marquee, pipeline, win rate, weighted forecast)
          · Recent activity · Alerts. The variant rendered depends on the signed-in user's role.
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
      </Card>
    </div>
  );
}
