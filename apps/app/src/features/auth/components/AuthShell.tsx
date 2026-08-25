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

// Fixed brand surface for the hero panel (identical in light + dark, per the
// design handoff): #08091C base with a blue glow top-right and a violet glow
// bottom-left, matching getnavigatr.io's hero.
const HERO_BG =
  "radial-gradient(115% 85% at 88% 4%, rgba(46,95,226,.60), rgba(8,9,28,0) 58%)," +
  "radial-gradient(95% 75% at 8% 104%, rgba(168,112,240,.32), rgba(8,9,28,0) 60%)," +
  "#08091C";
// Hairline seam that keeps the split visible in dark mode, where both panels
// are deep navy.
const HERO_SEAM = "rgba(159,174,232,0.14)";

/** Decorative route motif: a dotted path with three pins. aria-hidden; nods to
 *  the field GPS story and fills the dead vertical space. */
function RouteMotif() {
  const pins: Array<[number, number]> = [
    [56, 548],
    [212, 316],
    [300, 96],
  ];
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 600"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-50"
    >
      <path
        d="M56 548 C 150 470, 120 380, 212 316 S 330 210, 300 96"
        fill="none"
        stroke="#9FAEE8"
        strokeWidth={2}
        strokeDasharray="2 12"
        strokeLinecap="round"
      />
      {pins.map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={6} fill="none" stroke="#9FAEE8" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={2.5} fill="#9FAEE8" />
        </g>
      ))}
    </svg>
  );
}

/**
 * Two-column shell — form on the left, brand hero on the right. The hero is a
 * fixed brand surface (same in light + dark); only the form panel themes. Hero
 * collapses below `md`. Used by Login, signup, create-org and accept-invite.
 *
 * `heroTitle` is the plain part of the headline; the optional `heroTitleAccent`
 * is appended in the blue→violet gradient so the accent lands on the payoff
 * word (e.g. "every win.").
 */
export function AuthSplitShell({
  title,
  subtitle,
  heroEyebrow,
  heroTitle,
  heroTitleAccent,
  heroBody,
  children,
}: {
  title: string;
  subtitle?: string;
  heroEyebrow: string;
  heroTitle: string;
  heroTitleAccent?: string;
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

      {/* Right: fixed brand hero (md+ only) */}
      <aside
        className="relative hidden overflow-hidden md:block"
        style={{ background: HERO_BG, borderLeft: `1px solid ${HERO_SEAM}` }}
      >
        <RouteMotif />
        <div className="relative flex h-full flex-col justify-center gap-5 p-12">
          {/* Sentence-case in markup, uppercased via CSS so screen readers don't
              read it as an acronym. */}
          <span className="text-eyebrow uppercase tracking-widest" style={{ color: "#9FAEE8" }}>
            {heroEyebrow}
          </span>
          <h2 className="text-display-md leading-tight text-white">
            {heroTitle}
            {heroTitleAccent && (
              <>
                {" "}
                <span
                  style={{
                    backgroundImage: "linear-gradient(96deg,#6E9BFF,#C79BFF)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  {heroTitleAccent}
                </span>
              </>
            )}
          </h2>
          <p className="max-w-md text-body-lg" style={{ color: "#A3AEDA" }}>
            {heroBody}
          </p>
        </div>
      </aside>
    </main>
  );
}
