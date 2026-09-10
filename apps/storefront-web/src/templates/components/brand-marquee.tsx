'use client';

import Link from 'next/link';
import type { Brand } from '@retailos/types';
import { useTemplate } from '../context';
import { Section } from './section';

/**
 * A brand strip that drifts, or does not.
 *
 * A template with motion off gets a plain centred wrap — no duplicated list, no
 * animation, nothing to pause. A premium template gets a continuous rail, which
 * needs the items rendered twice so the loop has something to scroll into. The
 * duplicate is `aria-hidden`, so a screen reader hears each brand once.
 *
 * The track pauses on hover and on focus (see `globals.css`), because a link
 * that slides away from the pointer is a link nobody can click.
 */
export function BrandMarquee({ brands, title }: { brands: Brand[]; title: string }) {
  const { motion } = useTemplate();
  const drifting = motion.reveal !== 'none';

  const item = (brand: Brand, hidden = false) => (
    <li key={`${brand.id}${hidden ? '-echo' : ''}`} className="shrink-0">
      <Link
        href={`/products?brand=${brand.slug}`}
        tabIndex={hidden ? -1 : undefined}
        className="heading whitespace-nowrap text-lg text-content-subtle transition-colors hover:text-content sm:text-xl"
      >
        {brand.name}
      </Link>
    </li>
  );

  return (
    <Section tone="muted" className="!py-10" bleed={drifting}>
      <p className="mb-6 text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-content-subtle">
        {title}
      </p>

      {drifting ? (
        // `mask-image` fades the rail out at both ends so items appear and
        // vanish rather than being clipped mid-word.
        <div
          className="overflow-hidden"
          style={{
            maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
            WebkitMaskImage:
              'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
          }}
        >
          <ul className="marquee-track flex w-max items-center gap-x-14">
            {brands.slice(0, 10).map((brand) => item(brand))}
            {/* The second pass is scenery: it exists so the loop is seamless. */}
            <li aria-hidden="true" className="contents">
              <ul className="flex items-center gap-x-14 pl-14">
                {brands.slice(0, 10).map((brand) => item(brand, true))}
              </ul>
            </li>
          </ul>
        </div>
      ) : (
        <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {brands.slice(0, 10).map((brand) => item(brand))}
        </ul>
      )}
    </Section>
  );
}
