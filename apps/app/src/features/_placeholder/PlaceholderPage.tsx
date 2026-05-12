/**
 * Shared placeholder page renderer — used by every Phase-3 destination
 * until its real screen ships. Wraps the canonical Card.
 */

import { Card } from "@/components/navigatr";
import type { LucideIcon } from "lucide-react";

export interface PlaceholderPageProps {
  /** Feature name as it appears in the breadcrumb / page title. */
  title: string;
  /** Session number where the real screen ships. */
  comingInSession: number;
  /** Optional icon next to the title — usually the matching NavTab icon. */
  Icon?: LucideIcon;
  /** Optional body copy describing what this screen will do. */
  description?: string;
}

export function PlaceholderPage({ title, comingInSession, Icon, description }: PlaceholderPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="flex h-10 w-10 items-center justify-center rounded-radius-md bg-brand-primary-10 text-brand-primary">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div>
          <p className="text-eyebrow text-text-subtle">Placeholder</p>
          <h1 className="text-heading-xl text-text-default">{title}</h1>
        </div>
      </div>

      <Card padding="xl" shadow="sm">
        <p className="text-eyebrow text-text-subtle">Coming in Session {comingInSession}</p>
        <h2 className="mt-1 text-heading-md text-text-default">{title} — coming soon.</h2>
        {description && <p className="mt-3 max-w-2xl text-body-md text-text-muted">{description}</p>}
        <p className="mt-4 text-caption text-text-subtle">
          The navigation shell wraps this screen. Click any nav item to see the layout switch
          smoothly between sections.
        </p>
      </Card>
    </div>
  );
}
