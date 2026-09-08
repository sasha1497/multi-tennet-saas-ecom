import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@retailos/ui';

/**
 * The shell every home-page section renders inside.
 *
 * Vertical rhythm comes from `--tpl-section-space`, which the active template
 * sets — so an airy editorial design and a dense grocery one breathe
 * differently without either section knowing which template it is in.
 */
export function Section({
  children,
  className,
  bleed,
  tone = 'default',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** Full-width: skips the max-width container, for hero and banner sections. */
  bleed?: boolean;
  tone?: 'default' | 'muted' | 'ink';
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        'py-[var(--tpl-section-space)]',
        tone === 'muted' && 'bg-surface-muted',
        tone === 'ink' && 'bg-content text-surface',
        className,
      )}
    >
      {bleed ? children : <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">{children}</div>}
    </section>
  );
}

/**
 * Section heading.
 *
 * `align` and `rule` are the two dials that carry most of a template's voice at
 * this scale: a centred serif heading over a hairline reads as a boutique, the
 * same words left-aligned with a "view all" link read as a marketplace.
 */
export function SectionHeading({
  title,
  subtitle,
  href,
  linkLabel = 'View all',
  align = 'left',
  rule,
  className,
}: {
  title: string;
  subtitle?: string | null;
  href?: string;
  linkLabel?: string;
  align?: 'left' | 'center';
  rule?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-6 gap-4',
        align === 'center' ? 'text-center' : 'flex items-end justify-between',
        className,
      )}
    >
      <div className={cn(align === 'center' && 'mx-auto max-w-xl')}>
        <h2 className="heading text-[22px] leading-tight text-content sm:text-[26px]">{title}</h2>
        {subtitle && <p className="mt-1.5 text-sm text-content-muted">{subtitle}</p>}
        {rule && (
          <span
            aria-hidden="true"
            className={cn('mt-4 block h-px w-16 bg-accent', align === 'center' && 'mx-auto')}
          />
        )}
      </div>

      {href && align === 'left' && (
        <Link
          href={href}
          className="group shrink-0 whitespace-nowrap text-sm font-medium text-primary hover:underline"
        >
          {linkLabel}
          <ArrowRight
            className="ml-1 inline h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      )}

      {href && align === 'center' && (
        <div className="mt-5">
          <Link
            href={href}
            className="inline-flex h-10 items-center rounded-[var(--radius)] border border-content/20 px-5 text-sm font-medium text-content transition hover:border-content"
          >
            {linkLabel}
          </Link>
        </div>
      )}
    </div>
  );
}
