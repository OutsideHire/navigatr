import type { ReactNode } from "react";
import { Logo } from "@/components/layout/Logo";

/**
 * Single-column shell — centered card on the surface-canvas background.
 * Used by SignUp, ForgotPassword, ResetPassword.
 *
 * The brand lockup uses the unified Logo component, which composes
 * LogoMark (renders the user-supplied SVG verbatim, light/dark toggle
 * via Tailwind) + a Space Grotesk wordmark.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface-canvas px-4 py-10">
      <div className="mb-6">
        <Logo size="md" />
      </div>
      <div className="w-full max-w-md rounded-radius-lg border border-border-subtle bg-surface-elevated p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col gap-1.5">
          <h1 className="text-heading-lg text-text-default">{title}</h1>
          {subtitle && <p className="text-body-md text-text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * Two-column shell — form on the left, gradient brand hero on the right.
 * Hero collapses below `md`. Used by Login and InvitationAcceptance.
 */
export function AuthSplitShell({
  title,
  subtitle,
  heroEyebrow,
  heroTitle,
  heroBody,
  children,
}: {
  title: string;
  subtitle?: string;
  heroEyebrow: string;
  heroTitle: string;
  heroBody: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh bg-surface-canvas md:grid-cols-2">
      {/* Left: form column */}
      <section className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <Logo size="md" />
          </div>
          <div className="mb-6 flex flex-col gap-1.5">
            <h1 className="text-heading-lg text-text-default">{title}</h1>
            {subtitle && <p className="text-body-md text-text-muted">{subtitle}</p>}
          </div>
          {children}
        </div>
      </section>

      {/* Right: gradient hero (md+ only) */}
      <aside className="relative hidden overflow-hidden md:block">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-gradient-from via-brand-gradient-via to-brand-gradient-to" />
        {/* Soft inner glow + grid pattern for depth */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_60%)]" />
        {/* Dark-mode scrim: the dark-mode gradient stops are light enough that
            white hero text dips under WCAG AA; deepen the surface (dark only). */}
        <div className="absolute inset-0 hidden bg-black/25 dark:block" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <span className="text-eyebrow tracking-widest text-white/80">{heroEyebrow}</span>
          <div className="flex flex-col gap-4">
            <h2 className="text-display-md leading-tight">{heroTitle}</h2>
            <p className="max-w-md text-body-lg text-white/85">{heroBody}</p>
          </div>
          <div className="flex items-center gap-2 text-caption text-white/80">
            <span className="h-1.5 w-1.5 rounded-radius-full bg-white/80" />
            <span>The mobile-first sales platform for field reps</span>
          </div>
        </div>
      </aside>
    </main>
  );
}
