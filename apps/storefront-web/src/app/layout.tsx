import type { Metadata, Viewport } from 'next';
import { Inter, Bricolage_Grotesque, Fraunces, Nunito, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { StorefrontFrame } from '@/components/frame';
import { StoreClosed } from '@/components/store-closed';
import { currentHost, loadStorefront } from '@/lib/server-api';
import { activeTemplate } from '@/templates/resolve-server';
import { isDark, templateCssVariables } from '@/templates/theme';

/**
 * The type palette every template draws from.
 *
 * Loaded once, self-hosted by `next/font`, and exposed as CSS custom
 * properties — so switching template changes which stack is *referenced*, with
 * no extra request and no layout shift. A template names a variable
 * (`var(--font-serif)`), never a font file.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-serif', display: 'swap' });
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-tech',
  display: 'swap',
});
const nunito = Nunito({ subsets: ['latin'], variable: '--font-rounded', display: 'swap' });

const fontVariables = [
  inter.variable,
  fraunces.variable,
  bricolage.variable,
  spaceGrotesk.variable,
  nunito.variable,
].join(' ');

/**
 * Per-tenant metadata.
 *
 * Generated from the store resolved out of the request Host, so
 * `kickzone.ourdomain.in` and `abcstore.ourdomain.in` serve genuinely different
 * titles, descriptions and favicons from one deployment.
 */
export async function generateMetadata(): Promise<Metadata> {
  const data = await loadStorefront();
  if (!data) {
    return { title: 'Store not found', robots: { index: false, follow: false } };
  }

  const { store, tenant } = data;
  const host = currentHost();

  return {
    title: { default: store.storeName, template: `%s · ${store.storeName}` },
    description: store.tagline ?? store.description ?? `Shop online at ${store.storeName}.`,
    // A store that is not published yet must not be indexed.
    robots: store.isPublished ? { index: true, follow: true } : { index: false, follow: false },
    // A store without its own favicon gets a neutral bag mark rather than a
    // 404 on every page view.
    icons: { icon: store.faviconUrl ?? '/favicon.svg' },
    openGraph: {
      title: store.storeName,
      description: store.tagline ?? undefined,
      siteName: store.storeName,
      type: 'website',
      url: `https://${host}`,
      images: store.logoUrl ? [{ url: store.logoUrl }] : undefined,
    },
    alternates: { canonical: `https://${host}` },
    other: { 'x-retailos-tenant': tenant.slug },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const data = await loadStorefront();

  // No tenant for this hostname: render a standalone page rather than a broken
  // shell with an empty header.
  if (!data) {
    return (
      <html lang="en" className={fontVariables}>
        <body className="min-h-screen bg-surface-muted antialiased">
          <StoreClosed host={currentHost()} />
        </body>
      </html>
    );
  }

  const { template, isPreview } = activeTemplate(data);

  return (
    <html
      lang="en"
      className={fontVariables}
      data-template={template.id}
      // The active template's palette, type and rhythm — merged with whatever
      // branding the merchant explicitly set — become CSS custom properties on
      // the root element, which every component already reads. One deployment,
      // N designs, no rebuild, and server-rendered, so there is no flash of the
      // wrong design on first paint.
      style={
        {
          ...templateCssVariables(template.theme, data.store),
          // Native controls, scrollbars and autofill follow the design's ground.
          colorScheme: isDark(template.theme.surfaceColor) ? 'dark' : 'light',
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-surface-muted antialiased">
        <StorefrontFrame bootstrap={data} template={template} isPreview={isPreview}>
          {children}
        </StorefrontFrame>
      </body>
    </html>
  );
}
