import { cn } from '@retailos/ui';

/**
 * The RetailOS mark.
 *
 * An arch on a plinth: a shop doorway reduced to two strokes. It reads as an
 * opening rather than a letter, which is the one idea the whole product is
 * about — a merchant getting a shop of their own open. Deliberately geometric
 * and monoline so it survives at 20px in a sidebar and at 64px in a hero, and
 * so it never competes with a tenant's own branding when the two sit together.
 */
export function Logo({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <g
        fill="none"
        stroke="rgb(var(--color-primary-fg))"
        strokeWidth="2.6"
        strokeLinecap="round"
      >
        <path d="M10 22v-6.4a6 6 0 0 1 12 0V22" />
        <path d="M8.2 22.6h15.6" />
      </g>
    </svg>
  );
}

/**
 * Mark plus wordmark.
 *
 * One component so the lockup's proportions are decided once, rather than being
 * re-guessed on the landing page, the sign-in screen and the console rail.
 */
export function Wordmark({
  className,
  markClassName,
  href,
}: {
  className?: string;
  markClassName?: string;
  href?: string;
}) {
  const content = (
    <>
      <Logo className={cn('h-8 w-8', markClassName)} />
      <span className="text-lg font-semibold tracking-[-0.02em]">RetailOS</span>
    </>
  );

  const classes = cn('inline-flex items-center gap-2.5', className);

  return href ? (
    <a href={href} className={classes} aria-label="RetailOS home">
      {content}
    </a>
  ) : (
    <span className={classes}>{content}</span>
  );
}
