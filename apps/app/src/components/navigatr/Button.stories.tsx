/**
 * Visual catalog for the canonical Button component.
 *
 * Renders every variant × size × state combo plus icon configurations so
 * you can eyeball against Figma node 19:300 side-by-side. Not a real
 * Storybook config — just a static React tree mounted at
 * `/component-preview/button`.
 *
 * Includes a dark-mode toggle in the corner because Button colors come from
 * CSS variables that swap on `.dark`, and we want to verify both modes
 * from one screen.
 */

import { ArrowRight, Download, Plus, Sun, Moon, Monitor, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { useTheme, type Theme } from "@/stores/theme";

const VARIANTS = ["primary", "secondary", "tertiary", "destructive", "gradient"] as const;
const SIZES = ["sm", "md", "lg"] as const;

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

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="text-eyebrow text-text-subtle">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-radius-lg border border-border-subtle bg-surface-elevated p-6">
      <div>
        <h2 className="text-heading-md text-text-default">{title}</h2>
        {subtitle && <p className="mt-1 text-body-md text-text-muted">{subtitle}</p>}
      </div>
      <div className="grid gap-5">{children}</div>
    </section>
  );
}

export function ButtonStories() {
  const theme = useTheme((s) => s.theme);
  const resolvedTheme = useTheme((s) => s.resolvedTheme);
  const setTheme = useTheme((s) => s.setTheme);
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <main className="min-h-dvh bg-surface-canvas px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-eyebrow text-text-subtle">Component preview · Button</p>
            <h1 className="mt-1 text-heading-xl text-text-default">Canonical Button — Figma fidelity</h1>
            <p className="mt-2 max-w-2xl text-body-md text-text-muted">
              Sourced from <code className="text-code text-text-default">navigatr v1 · 19:300</code>. Every
              combination below maps directly to a Figma variant. Use this to spot-check against the Figma
              file. <code className="text-code">gradient</code> is a code-only addition not yet in Figma.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTheme(NEXT_THEME[theme])}
            className="inline-flex items-center gap-2 rounded-radius-md border border-border-default bg-surface-elevated px-3 py-2 text-body-md text-text-default transition-colors hover:bg-surface-sunken"
          >
            <ThemeIcon className="h-4 w-4" />
            <span>
              Theme: {THEME_LABEL[theme]}
              <span className="ml-1 text-text-subtle">({resolvedTheme})</span>
            </span>
          </button>
        </header>

        {/* Reference table */}
        <details className="rounded-radius-lg border border-border-subtle bg-surface-sunken p-5 text-body-md">
          <summary className="cursor-pointer text-body-strong text-text-default">
            Spec table (per Figma)
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 text-caption text-text-muted sm:grid-cols-2">
            <div>
              <p className="text-eyebrow text-text-subtle">Dimensions</p>
              <ul className="mt-1 space-y-1 font-mono">
                <li>sm — h 32, px 12, gap 8, radius/sm, body/md, icon 16</li>
                <li>md — h 40, px 16, gap 8, radius/md, body/md, icon 16</li>
                <li>lg — h 48, px 20, gap 10, radius/md, body/lg, icon 20</li>
              </ul>
            </div>
            <div>
              <p className="text-eyebrow text-text-subtle">Color rules</p>
              <ul className="mt-1 space-y-1">
                <li>primary → brand/primary fill, *-foreground text</li>
                <li>secondary → surface/elevated fill, border/default, text/default</li>
                <li>tertiary → no fill, brand/primary text, surface/sunken on hover</li>
                <li>destructive → status/danger fill, text/inverse</li>
                <li>gradient → brand/gradient-from→via→to (code-only)</li>
                <li>disabled → opacity 0.5 on the whole element</li>
              </ul>
            </div>
          </div>
        </details>

        {/* Variant × Size grid (rest state) */}
        <Section title="Variant × Size" subtitle="Default (rest) state, with leading icon">
          {VARIANTS.map((variant) => (
            <Cell key={variant} label={variant}>
              {SIZES.map((size) => (
                <Button key={size} variant={variant} size={size} leadingIcon={Download}>
                  {variant === "destructive" ? "Delete account" : "Get started"}
                </Button>
              ))}
            </Cell>
          ))}
        </Section>

        {/* States — per variant, md size */}
        <Section
          title="States (md, with leading icon)"
          subtitle="rest · hover (use :hover) · pressed (use :active) · disabled · loading. Hover/active states are CSS-driven — actually mouse over to see them."
        >
          {VARIANTS.map((variant) => (
            <Cell key={variant} label={`${variant}`}>
              <Button variant={variant} size="md" leadingIcon={Download}>
                Rest
              </Button>
              <Button variant={variant} size="md" leadingIcon={Download} disabled>
                Disabled
              </Button>
              <Button variant={variant} size="md" leadingIcon={Download} loading>
                Loading
              </Button>
            </Cell>
          ))}
        </Section>

        {/* Icon configurations */}
        <Section title="Icon configurations (primary, md)">
          <Cell label="leading icon">
            <Button variant="primary" leadingIcon={Plus}>Add deal</Button>
            <Button variant="secondary" leadingIcon={Plus}>Add deal</Button>
            <Button variant="tertiary" leadingIcon={Plus}>Add deal</Button>
          </Cell>
          <Cell label="trailing icon">
            <Button variant="primary" trailingIcon={ArrowRight}>Continue</Button>
            <Button variant="secondary" trailingIcon={ArrowRight}>Continue</Button>
            <Button variant="tertiary" trailingIcon={ArrowRight}>Continue</Button>
          </Cell>
          <Cell label="both icons">
            <Button variant="primary" leadingIcon={Plus} trailingIcon={ArrowRight}>
              Add deal
            </Button>
          </Cell>
          <Cell label="no icons">
            <Button variant="primary">Plain label</Button>
            <Button variant="secondary">Plain label</Button>
            <Button variant="tertiary">Plain label</Button>
            <Button variant="destructive">Plain label</Button>
          </Cell>
        </Section>

        {/* Icon-only */}
        <Section title="Icon-only (square)">
          <Cell label="sm · md · lg per variant">
            {VARIANTS.map((variant) => (
              <div key={variant} className="flex items-center gap-3">
                <Button variant={variant} size="sm" iconOnly leadingIcon={variant === "destructive" ? Trash2 : Plus} aria-label="Add deal" />
                <Button variant={variant} size="md" iconOnly leadingIcon={variant === "destructive" ? Trash2 : Plus} aria-label="Add deal" />
                <Button variant={variant} size="lg" iconOnly leadingIcon={variant === "destructive" ? Trash2 : Plus} aria-label="Add deal" />
              </div>
            ))}
          </Cell>
        </Section>

        {/* Full-width */}
        <Section title="Full-width (primary)" subtitle="Stretches to fill the parent column.">
          <div className="flex max-w-md flex-col gap-3">
            <Button variant="primary" size="md" fullWidth leadingIcon={Download}>
              Sign in
            </Button>
            <Button variant="secondary" size="md" fullWidth leadingIcon={Download}>
              Continue with Google
            </Button>
            <Button variant="tertiary" size="md" fullWidth>
              Forgot password?
            </Button>
          </div>
        </Section>

        {/* Loading variants */}
        <Section title="Loading (all variants, md)">
          <Cell label="aria-busy=true, leading slot replaced with spinner">
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} size="md" loading>
                Saving…
              </Button>
            ))}
          </Cell>
        </Section>
      </div>
    </main>
  );
}
