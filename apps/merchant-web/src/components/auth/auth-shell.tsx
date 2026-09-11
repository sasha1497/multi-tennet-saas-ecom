'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { cn } from '@retailos/ui';
import { Logo } from '@/components/console/logo';

/* ---------------------------------------------------------------------------
 * The sign-in / sign-up frame.
 *
 * A split: the form on the left at a comfortable reading width, and an ink
 * panel on the right that carries the product's argument. The panel is the
 * first thing a new merchant sees of RetailOS, and it disappears entirely below
 * `lg` — on a phone the form is the only thing that matters and it gets the
 * whole screen rather than being pushed below a hero.
 * ------------------------------------------------------------------------- */

export interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
  /** Rendered under the card — the "already have an account" line. */
  footer?: ReactNode;
  /** The right-hand panel's headline and supporting points. */
  aside: { heading: string; points: string[]; note?: string };
  /** Widens the form column for the longer sign-up form. */
  wide?: boolean;
}

export function AuthShell({ title, description, children, footer, aside, wide }: AuthShellProps) {
  return (
    // Light, like the landing page it follows on from — signing in is still a
    // brand surface, not yet the console. See the note in globals.css.
    <div className="theme-light flex min-h-screen bg-surface">
      {/* ------------------------------------------------------------ form -- */}
      <div className="flex min-w-0 flex-1 flex-col px-5 py-8 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg text-content"
            aria-label="RetailOS home"
          >
            <Logo className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-[-0.02em]">RetailOS</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to site
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className={cn('w-full', wide ? 'max-w-lg' : 'max-w-sm')}>
            <h1 className="text-3xl font-semibold text-content">{title}</h1>
            <p className="mt-2 text-base text-content-muted">{description}</p>

            <div className="mt-8">{children}</div>

            {footer && <div className="mt-7 text-base text-content-muted">{footer}</div>}
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- aside -- */}
      <aside className="relative hidden w-[38%] max-w-xl shrink-0 overflow-hidden bg-rail lg:block">
        {/* Anchored inside the panel rather than reusing the hero's wash, which
            is positioned for a full-width section and falls off the top here. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(38rem 30rem at 30% 28%, rgb(91 68 220 / 0.30), transparent 68%)',
          }}
          aria-hidden="true"
        />
        <div className="relative flex h-full flex-col justify-center px-12 py-16">
          <h2 className="text-3xl font-semibold leading-tight text-rail-fg">{aside.heading}</h2>

          <ul className="mt-10 space-y-5">
            {aside.points.map((point) => (
              <li key={point} className="flex gap-3.5">
                <span className="mt-0.5 flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full bg-primary/25 text-primary">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                </span>
                <span className="text-base leading-6 text-rail-muted">{point}</span>
              </li>
            ))}
          </ul>

          {aside.note && (
            <p className="mt-12 border-t border-rail-line pt-6 text-sm text-rail-subtle">
              {aside.note}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * The form-level error banner.
 *
 * `role="alert"` so a failed submit is announced, not just recoloured — the one
 * moment on these screens where a screen-reader user is otherwise left with no
 * idea why nothing happened.
 */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-3 text-base text-danger-700 dark:border-danger-700/40 dark:bg-danger-700/15 dark:text-danger-100"
    >
      <svg
        viewBox="0 0 20 20"
        className="mt-0.5 h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="8" />
        <path d="M10 6.5v4M10 13.5h.01" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </div>
  );
}
