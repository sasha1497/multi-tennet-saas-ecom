import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { StorefrontFrame } from '@/components/frame';
import { StoreClosed } from '@/components/store-closed';
import { currentHost, loadStorefront } from '@/lib/server-api';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

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
    icons: store.faviconUrl ? { icon: store.faviconUrl } : undefined,
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
      <html lang="en" className={inter.variable}>
        <body className="min-h-screen bg-surface-muted antialiased">
          <StoreClosed host={currentHost()} />
        </body>
      </html>
    );
  }

  const { theme } = data.store;

  return (
    <html
      lang="en"
      className={inter.variable}
      // The merchant's colours become CSS custom properties on the root element,
      // which every component already reads. One deployment, N brand identities,
      // no rebuild — and it is server-rendered, so there is no flash of the
      // wrong colour on first paint.
      style={
        {
          '--color-primary': hexToRgbChannels(theme.primaryColor),
          '--color-accent': hexToRgbChannels(theme.accentColor),
          '--color-primary-soft': hexToRgbChannels(mixWithWhite(theme.primaryColor, 0.92)),
          '--radius': RADIUS_SCALE[theme.radius] ?? '10px',
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-surface antialiased">
        <StorefrontFrame bootstrap={data}>{children}</StorefrontFrame>
      </body>
    </html>
  );
}

const RADIUS_SCALE: Record<string, string> = {
  none: '0px',
  sm: '6px',
  md: '10px',
  lg: '14px',
  full: '9999px',
};

/** `#1f47e0` -> `31 71 224`, the space-separated form Tailwind's alpha syntax needs. */
function hexToRgbChannels(hex: string): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return '31 71 224';
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

/** Produces the soft tint used for subtle backgrounds from the brand colour. */
function mixWithWhite(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return '#eef4ff';
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const r = mix((value >> 16) & 255);
  const g = mix((value >> 8) & 255);
  const b = mix(value & 255);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
