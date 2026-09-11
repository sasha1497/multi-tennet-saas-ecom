'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { cn } from '@retailos/ui';
import { Logo } from '@/components/console/logo';
import { useAuth } from '@/lib/auth-context';

/* ---------------------------------------------------------------------------
 * Marketing chrome.
 *
 * The public site shares the console's tokens on purpose: a visitor who signs
 * up should recognise the product they were sold. It is the same typography,
 * the same iris, the same geometry — just given room to breathe.
 * ------------------------------------------------------------------------- */

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#templates', label: 'Templates' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function MarketingNav() {
  const { session, loading } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  // A transparent bar over the hero that earns a hairline once you leave it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-200',
        scrolled
          ? 'border-b border-line bg-surface/80 backdrop-blur-md'
          : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-content"
          aria-label="RetailOS home"
        >
          <Logo className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-[-0.02em]">RetailOS</span>
        </Link>

        <nav aria-label="Primary" className="ml-6 hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-base font-medium text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* The session is read, not required: a merchant already signed in gets
              a way back into their console instead of a sign-in link they do not
              need. `loading` renders neither, so the bar never flickers. */}
          {!loading &&
            (session ? (
              <Link
                href="/dashboard"
                className="inline-flex h-9.5 items-center gap-1.5 rounded-lg bg-primary px-4 text-base font-medium text-primary-fg shadow-xs transition-[filter] hover:brightness-110"
              >
                Go to console
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden h-9.5 items-center rounded-lg px-3.5 text-base font-medium text-content-muted transition-colors hover:bg-surface-muted hover:text-content sm:inline-flex"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="inline-flex h-9.5 items-center rounded-lg bg-primary px-4 text-base font-medium text-primary-fg shadow-xs transition-[filter] hover:brightness-110"
                >
                  Create your store
                </Link>
              </>
            ))}

          {/* The sheet carries its own dismiss control, so this only ever opens. */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-label="Open menu"
            className="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-muted hover:text-content lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Mobile sheet. Full-height so the links are thumb-reachable. */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-neutral-950/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <nav
            aria-label="Primary"
            className="absolute inset-x-0 top-0 rounded-b-2xl border-b border-line bg-surface p-5 shadow-xl animate-rise-in"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <Logo className="h-8 w-8" />
                <span className="text-lg font-semibold tracking-[-0.02em]">RetailOS</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2 text-content-muted hover:bg-surface-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul className="space-y-1">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-lg px-3 py-2.5 text-md font-medium text-content transition-colors hover:bg-surface-muted"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
              {!session && (
                <li>
                  <Link
                    href="/login"
                    className="block rounded-lg px-3 py-2.5 text-md font-medium text-content transition-colors hover:bg-surface-muted"
                  >
                    Sign in
                  </Link>
                </li>
              )}
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}

// -------------------------------------------------------------- sections --

/** One band of the page. Owns its vertical rhythm so the sections stay in step. */
export function Section({
  id,
  children,
  className,
  tone = 'default',
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'muted';
}) {
  return (
    <section
      id={id}
      // `scroll-mt` clears the sticky bar when an anchor link lands here.
      className={cn(
        'scroll-mt-16 py-20 sm:py-24',
        tone === 'muted' && 'border-y border-line bg-surface-muted',
        className,
      )}
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-6">{children}</div>
    </section>
  );
}

export function SectionHead({
  eyebrow,
  title,
  description,
  align = 'center',
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: 'center' | 'left';
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Wide enough that a two-clause heading breaks where the meaning does,
        // with the supporting line held narrower so it stays a comfortable read.
        'max-w-3xl',
        align === 'center' ? 'mx-auto text-center' : 'text-left',
        className,
      )}
    >
      {eyebrow && <p className="eyebrow mb-3 text-primary">{eyebrow}</p>}
      <h2 className="text-balance text-3xl font-semibold text-content sm:text-4xl">{title}</h2>
      {description && (
        <p
          className={cn(
            'mt-4 max-w-2xl text-lg leading-7 text-content-muted',
            align === 'center' && 'mx-auto',
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- footer --

const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'How it works', href: '#how' },
      { label: 'Templates', href: '#templates' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    title: 'Get started',
    links: [
      { label: 'Create your store', href: '/register' },
      { label: 'Sign in', href: '/login' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Help centre', href: '#faq' },
      { label: 'Contact sales', href: '#pricing' },
      { label: 'Status', href: '#faq' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms of service', href: '#faq' },
      { label: 'Privacy policy', href: '#faq' },
      { label: 'Refund policy', href: '#faq' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <span className="flex items-center gap-2.5 text-content">
              <Logo className="h-8 w-8" />
              <span className="text-lg font-semibold tracking-[-0.02em]">RetailOS</span>
            </span>
            <p className="mt-4 text-base leading-6 text-content-muted">
              Everything a local retailer needs to sell online — a storefront, a catalogue and one
              console to run it from.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-base font-semibold text-content">{column.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-base text-content-muted transition-colors hover:text-content"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
          <p className="text-sm text-content-subtle">
            © {new Date().getFullYear()} RetailOS. All rights reserved.
          </p>
          <p className="text-sm text-content-subtle">Built for retailers in India.</p>
        </div>
      </div>
    </footer>
  );
}
