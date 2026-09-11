import type { Metadata } from 'next';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';

/**
 * The public site.
 *
 * The root layout marks everything `noindex` because the console is an
 * authenticated surface. This group is the exception — it is the one part of
 * this app meant to be found — so it restates `robots` for its own routes.
 */
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    // `theme-light`: the public site does not follow the visitor's OS theme.
    // See the note in globals.css.
    <div className="theme-light flex min-h-screen flex-col bg-surface">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <MarketingNav />
      <main id="main" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
