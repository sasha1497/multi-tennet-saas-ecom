'use client';

import { useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Move3d } from 'lucide-react';
import { cn } from '@retailos/ui';
import { themeColor, useThreeScene } from './use-three-scene';

export interface HeroProduct {
  name: string;
  href: string;
  image: string;
}

interface Hero3DProps {
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  storeName: string;
  products: HeroProduct[];
  /** The store is entitled to 3D, or the merchant is previewing. */
  allow3d: boolean;
}

/**
 * Products shoppers can reach without the canvas — keyboard, screen reader, or
 * a 2D device. The 3D scene is a way to browse these, never the only one.
 */
function ProductLinks({ products, className }: { products: HeroProduct[]; className?: string }) {
  return (
    <ul className={className} aria-label="Featured products">
      {products.map((p) => (
        <li key={p.href}>
          <Link href={p.href}>{p.name}</Link>
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────────────────────────────────────────── orbit ──

/**
 * Orbit's opening: the headline at the centre of a ring of product photos.
 *
 * Server-renders a fanned arc of the same photos with CSS perspective — a
 * finished design on its own — and, where the device allows, replaces it with
 * the WebGL ring the shopper can spin.
 */
export function OrbitHero({ title, subtitle, ctaLabel, ctaHref, storeName, products, allow3d }: Hero3DProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photos = products.slice(0, 10);

  const mount = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const { mountOrbit } = await import('./scenes');
      return mountOrbit(canvas, {
        photos: photos.map((p) => ({ url: p.image, href: p.href })),
        accent: themeColor('--color-primary', 0xd4ff3a),
        onSelect: (href) => router.push(href),
      });
    },
    // Photos are fixed for the life of a server render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );
  const state = useThreeScene(allow3d && photos.length >= 3, containerRef, canvasRef, mount);
  const live = state === '3d';
  const fan = photos.slice(0, 5);

  return (
    <section
      ref={containerRef}
      className="relative isolate overflow-hidden bg-surface-muted text-content"
      style={{ minHeight: 'clamp(560px, 88vh, 820px)' }}
    >
      {/* Ambient glow, shared by both renderings. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 62%, rgb(var(--color-accent) / 0.35), transparent 70%)',
        }}
      />

      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn(
          'absolute inset-0 h-full w-full transition-opacity duration-700',
          live ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <div className="pointer-events-none relative mx-auto flex max-w-5xl flex-col items-center px-4 pt-16 text-center sm:px-6 sm:pt-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-content-muted">
          {storeName}
        </p>
        <h1 className="heading mt-4 max-w-4xl break-words text-[clamp(2.25rem,7vw,5.25rem)] leading-[0.95] [text-shadow:0_2px_30px_rgb(0_0_0/0.35)]">
          {title}
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-content-muted">{subtitle}</p>
        <div className="pointer-events-auto mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={ctaHref}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-fg transition hover:brightness-110"
          >
            {ctaLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-xs text-content-muted">
              <Move3d className="h-3.5 w-3.5" aria-hidden="true" />
              Drag to spin · tap a product
            </span>
          )}
        </div>
      </div>

      {/* 2D composition: a fanned arc in CSS perspective. Hidden, not removed,
          once the ring takes over, so layout never jumps. */}
      {fan.length > 0 && (
        <div
          aria-hidden={live}
          className={cn(
            'relative mx-auto mt-10 flex h-[260px] max-w-4xl items-end justify-center px-4 pb-10 transition-opacity duration-500 sm:h-[300px] [perspective:1200px]',
            live && 'pointer-events-none opacity-0',
          )}
        >
          {fan.map((p, i) => {
            const offset = i - (fan.length - 1) / 2;
            return (
              <Link
                key={p.href}
                href={p.href}
                tabIndex={live ? -1 : undefined}
                className="relative -mx-3 block w-[28%] max-w-[180px] shrink-0 overflow-hidden rounded-[var(--radius)] shadow-2xl ring-1 ring-white/10 transition-transform duration-300 hover:-translate-y-2 sm:-mx-4"
                style={{
                  aspectRatio: '3 / 4',
                  transform: `rotateY(${offset * -14}deg) translateZ(${-Math.abs(offset) * 60}px) translateY(${Math.abs(offset) * 14}px)`,
                  zIndex: 10 - Math.abs(Math.round(offset)),
                }}
              >
                <img src={p.image} alt={p.name} className="h-full w-full object-cover" loading={i === 2 ? 'eager' : 'lazy'} />
              </Link>
            );
          })}
        </div>
      )}

      {live && <ProductLinks products={photos} className="sr-only" />}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────── prism ──

/**
 * Prism's opening: quiet type on the left, product plates suspended in light
 * on the right. The 2D composition is the same constellation, still; the 3D
 * one floats, turns towards the pointer and catches a moving highlight.
 */
export function PrismHero({ title, subtitle, ctaLabel, ctaHref, storeName, products, allow3d }: Hero3DProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photos = products.slice(0, 7);

  const mount = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const { mountPrism } = await import('./scenes');
      return mountPrism(canvas, {
        photos: photos.map((p) => ({ url: p.image, href: p.href })),
        accent: themeColor('--color-accent', 0xc9a46b),
        onSelect: (href) => router.push(href),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );
  const state = useThreeScene(allow3d && photos.length >= 3, containerRef, canvasRef, mount);
  const live = state === '3d';

  // Positions for the 2D constellation, as % of the stage.
  const spots: [number, number, number, number][] = [
    [50, 46, 34, 0],
    [16, 24, 22, -6],
    [82, 22, 21, 5],
    [22, 76, 20, 4],
    [80, 76, 22, -4],
  ];

  return (
    <section ref={containerRef} className="relative overflow-hidden bg-surface-muted">
      <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-20">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-content-subtle">
            {storeName}
          </p>
          <h1 className="heading mt-5 break-words text-[clamp(2.25rem,5.5vw,4.5rem)] leading-[1.02] text-content">
            {title}
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-content-muted">{subtitle}</p>
          <Link
            href={ctaHref}
            className="mt-8 inline-flex items-center gap-3 border-b border-content pb-1 text-sm font-medium tracking-wide text-content transition hover:gap-4"
          >
            {ctaLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="relative min-w-0" style={{ aspectRatio: '6 / 5' }}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[8%] rounded-full blur-3xl"
            style={{ background: 'rgb(var(--color-accent) / 0.22)' }}
          />
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className={cn(
              'absolute inset-0 h-full w-full transition-opacity duration-1000',
              live ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          />
          <div
            aria-hidden={live}
            className={cn('absolute inset-0 transition-opacity duration-700', live && 'pointer-events-none opacity-0')}
          >
            {photos.slice(0, spots.length).map((p, i) => {
              const [x, y, w, r] = spots[i]!;
              return (
                <Link
                  key={p.href}
                  href={p.href}
                  tabIndex={live ? -1 : undefined}
                  className="absolute block overflow-hidden bg-surface shadow-xl ring-1 ring-black/5 transition-transform duration-500 hover:scale-[1.03]"
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    width: `${w}%`,
                    aspectRatio: '4 / 5',
                    transform: `translate(-50%, -50%) rotate(${r}deg)`,
                    zIndex: i === 0 ? 5 : 1,
                  }}
                >
                  <img src={p.image} alt={p.name} className="h-full w-full object-cover" loading={i === 0 ? 'eager' : 'lazy'} />
                </Link>
              );
            })}
          </div>
          {live && (
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-surface/80 px-3 py-1.5 text-[11px] text-content-muted backdrop-blur">
              <Move3d className="h-3.5 w-3.5" aria-hidden="true" />
              Move to look around · tap a piece
            </span>
          )}
        </div>
      </div>
      {live && <ProductLinks products={photos} className="sr-only" />}
    </section>
  );
}
