/**
 * LegalPageShell — shared chrome for /terms and /privacy.
 *
 * Renders without the authenticated AppLayout because legal pages must be
 * publicly reachable (link from emails, link from vendor questionnaires,
 * link from the marketing site). Same look + feel as the auth screens —
 * centered column, brand logo header, modest typography.
 *
 * The DRAFT banner is intentional. Until a lawyer reviews the copy, the
 * banner makes the legal status unambiguous to anyone reading it.
 */
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Logo } from "@/components/layout/Logo";

interface Props {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export function LegalPageShell({ title, lastUpdated, children }: Props) {
  return (
    <div className="min-h-dvh bg-surface-canvas text-text-default">
      {/* Top bar — minimal, just the brand + a home link. No auth chrome. */}
      <header className="border-b border-border-subtle bg-surface-default">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/" aria-label="navigatr home">
            <Logo size="sm" />
          </Link>
          <Link
            to="/login"
            className="text-body-sm text-text-muted hover:text-text-default"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {/* DRAFT banner. Visible on every load until production legal copy
            replaces the placeholder. */}
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-radius-md border border-status-warning/40 bg-status-warning-bg/40 px-4 py-3 text-body-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden />
          <div>
            <p className="font-medium text-text-default">DRAFT — not legally reviewed</p>
            <p className="mt-0.5 text-caption text-text-muted">
              This is placeholder copy intended for product completeness and
              vendor security review. Final terms will be published before
              the first paying customer.
            </p>
          </div>
        </div>

        <h1 className="text-heading-xl text-text-default">{title}</h1>
        <p className="mt-1.5 text-caption text-text-muted">
          Last updated: {lastUpdated}
        </p>

        {/* prose-ish content styling — text-body-md with tighter spacing
            on headings, indentation on ul. The legal pages use real h2/p/ul
            tags so screen readers + bots get proper structure. */}
        <article className="mt-8 flex flex-col gap-6 text-body-md leading-relaxed text-text-default [&_h2]:mt-4 [&_h2]:text-heading-sm [&_h2]:text-text-default [&_p]:text-text-muted [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:text-text-muted [&_li]:mt-1 [&_a]:text-brand-primary [&_a:hover]:underline">
          {children}
        </article>

        <footer className="mt-12 border-t border-border-subtle pt-6 text-caption text-text-subtle">
          <p>
            <Link to="/terms" className="hover:text-text-default">Terms</Link>
            {" · "}
            <Link to="/privacy" className="hover:text-text-default">Privacy</Link>
            {" · "}
            <a href="mailto:legal@outsidehire.com" className="hover:text-text-default">
              legal@outsidehire.com
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
