'use client';

import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react';
import { cn } from '@retailos/ui';

/* ---------------------------------------------------------------------------
 * Console primitives.
 *
 * These are the console's own vocabulary, kept out of `@retailos/ui` on purpose:
 * that package is shared with the storefront, and a tenant's shop must not move
 * because the admin got a new panel style. Anything genuinely generic still
 * comes from the shared package — Button, Badge, Input, DataTable — and these
 * compose with it rather than replacing it.
 * ------------------------------------------------------------------------- */

// ------------------------------------------------------------------ page --

/**
 * The page frame.
 *
 * One max width and one vertical rhythm for every console screen, so moving
 * between Products and Reports never shifts the content column sideways.
 */
export function PageShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-[88rem] space-y-5', className)} {...props} />;
}

export interface PageHeadProps {
  title: ReactNode;
  description?: ReactNode;
  /** Rendered above the title. The last crumb is the current page and is not a link. */
  breadcrumbs?: { label: string; href?: string }[];
  /** Primary and secondary actions, right-aligned on desktop, wrapped on mobile. */
  actions?: ReactNode;
  /** Small status chips under the title — plan, store address, live state. */
  meta?: ReactNode;
  className?: string;
}

/**
 * Page header.
 *
 * Title, one line of orientation, and the page's actions — in that order of
 * visual weight, because "what is this screen and what can I do here" is the
 * question every admin page has to answer in the first second.
 */
export function PageHead({
  title,
  description,
  breadcrumbs,
  actions,
  meta,
  className,
}: PageHeadProps) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      {/*
       * `min-w-[min(100%,18rem)]` is what makes this header responsive without a
       * breakpoint. A bare `flex-1 min-w-0` lets the title column shrink to
       * nothing when the actions are wide, which on a phone rendered the page
       * title one character per line. Claiming 18rem — or the full width,
       * whichever is smaller — forces the actions onto their own row instead.
       */}
      <div className="min-w-[min(100%,18rem)] flex-1">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <ChevronRight className="h-3 w-3 shrink-0 text-content-subtle" aria-hidden="true" />
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="rounded text-content-muted transition-colors hover:text-content"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="font-medium text-content" aria-current="page">
                    {crumb.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-balance text-2xl font-semibold text-content">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-base text-content-muted">{description}</p>
        )}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ----------------------------------------------------------------- panel --

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** `quiet` drops the shadow — right for a panel nested inside another. */
  tone?: 'default' | 'quiet';
}

/**
 * The console's surface.
 *
 * Deliberately flatter than a "card": a hairline, a whisper of elevation and
 * square-ish corners. Stacked panels are how every screen here is built, so the
 * elevation has to survive being repeated eight times down a page.
 */
export function Panel({ className, tone = 'default', ...props }: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface-raised',
        tone === 'default' && 'shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export interface PanelHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Drops the bottom hairline when the body draws its own separation. */
  bare?: boolean;
  className?: string;
}

export function PanelHeader({ title, description, action, bare, className }: PanelHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 px-5 py-4',
        !bare && 'border-b border-line',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-md font-semibold text-content">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-content-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function PanelFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}

/** A "see everything" link for a panel header. Consistent everywhere it appears. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1 rounded text-sm font-medium text-content-muted transition-colors hover:text-primary"
    >
      {children}
      <ChevronRight
        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

// ------------------------------------------------------------------ stat --

export interface StatCardProps {
  label: string;
  /** Already formatted — the card never does currency or locale work itself. */
  value: string;
  changePercent?: number | null;
  trend?: 'up' | 'down' | 'flat';
  comparisonLabel?: string;
  /** For metrics where a rise is bad, so colour follows meaning not direction. */
  invertTrend?: boolean;
  /** Raw series for the inline spark. Drawn only when there is real movement. */
  series?: number[];
  href?: string;
  loading?: boolean;
  className?: string;
}

/**
 * One headline number.
 *
 * The figure is the point, so it gets the size; the delta is context and sits
 * quietly beneath it. The delta never relies on colour alone — there is always
 * an arrow and a signed percentage, which is what keeps it readable in
 * greyscale, under colour-vision deficiency and in forced-colors mode.
 */
export function StatCard({
  label,
  value,
  changePercent,
  trend = 'flat',
  comparisonLabel,
  invertTrend,
  series,
  href,
  loading,
  className,
}: StatCardProps) {
  const good = invertTrend ? trend === 'down' : trend === 'up';
  const bad = invertTrend ? trend === 'up' : trend === 'down';

  /**
   * A spark is only drawn when the series actually moves.
   *
   * A store with no sales yet returns thirty zeroes, and a polyline through them
   * renders as a stray grey rule in the corner of the card — which reads as a
   * rendering bug rather than as "nothing happened". No movement, no spark.
   */
  const hasMovement = Boolean(series && series.length > 1 && new Set(series).size > 1);

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {hasMovement && <MicroSpark values={series!} trend={trend} />}
      </div>

      <p className="nums mt-3 text-3xl font-semibold leading-none text-content">
        {loading ? <span className="inline-block h-7 w-24 rounded bg-surface-muted" /> : value}
      </p>

      <div className="mt-3 flex items-center gap-1.5 text-xs">
        {changePercent !== null && changePercent !== undefined ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold nums',
              good && 'bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-100',
              bad && 'bg-danger-50 text-danger-700 dark:bg-danger-700/20 dark:text-danger-100',
              !good && !bad && 'bg-surface-muted text-content-muted',
            )}
          >
            {trend === 'up' ? (
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            ) : trend === 'down' ? (
              <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Minus className="h-3 w-3" aria-hidden="true" />
            )}
            {changePercent > 0 ? '+' : ''}
            {changePercent}%
          </span>
        ) : null}
        {comparisonLabel && <span className="truncate text-content-subtle">{comparisonLabel}</span>}
      </div>
    </>
  );

  const classes = cn(
    'block rounded-xl border border-line bg-surface-raised p-4 shadow-sm transition-[box-shadow,border-color] duration-150',
    href && 'hover:border-primary/40 hover:shadow-md',
    className,
  );

  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/**
 * The spark inside a stat card.
 *
 * Intentionally tiny and unlabelled: it answers "which way has this been going"
 * and nothing more. A flat series draws a flat rule rather than noise, so an
 * empty store does not get a fake-looking wiggle.
 */
export function MicroSpark({
  values,
  trend = 'flat',
  className,
}: {
  values: number[];
  trend?: 'up' | 'down' | 'flat';
  className?: string;
}) {
  const width = 64;
  const height = 22;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    // A flat series draws down the middle instead of dividing by zero.
    const y = span === 0 ? height / 2 : height - ((v - min) / span) * (height - 3) - 1.5;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const stroke =
    trend === 'up'
      ? 'var(--status-good)'
      : trend === 'down'
        ? 'var(--status-critical)'
        : 'var(--color-text-subtle)';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('shrink-0 overflow-visible', className)}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={span === 0 ? 'rgb(var(--color-border))' : stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// --------------------------------------------------------------- toolbar --

/**
 * The filter row above a table.
 *
 * Search, filters and bulk actions live together in one bar so a merchant never
 * hunts for the control that narrows the list they are looking at.
 */
export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-line px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}

// ----------------------------------------------------------------- chips --

/**
 * A small fact about the current context — plan, store address, live state.
 * Optionally a link, which is how "view your storefront" is offered everywhere.
 */
export function MetaChip({
  icon,
  children,
  href,
  external,
  tone = 'default',
}: {
  icon?: ReactNode;
  children: ReactNode;
  href?: string;
  external?: boolean;
  tone?: 'default' | 'accent';
}) {
  const classes = cn(
    'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors',
    tone === 'accent'
      ? 'border-primary/25 bg-primary-soft text-primary'
      : 'border-line bg-surface text-content-muted',
    href && 'hover:border-primary/40 hover:text-primary',
  );

  const inner = (
    <>
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="truncate">{children}</span>
    </>
  );

  if (!href) return <span className={classes}>{inner}</span>;
  return external ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className={classes}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={classes}>
      {inner}
    </Link>
  );
}

// --------------------------------------------------------------- buttons --

/**
 * A link that looks like a button.
 *
 * Navigation that happens to be the primary action on a screen is still
 * navigation: it must be an anchor, so it opens in a new tab on middle click,
 * shows its target in the status bar and is announced as a link. Routing a page
 * change through `<Button onClick={router.push}>` breaks all three, and that
 * pattern was starting to spread.
 *
 * The class list mirrors the shared `Button`'s so the two are indistinguishable
 * when they sit next to each other in a header.
 */
export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  external,
  leftIcon,
  rightIcon,
  className,
  children,
}: {
  href: string;
  variant?: 'primary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  external?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(
    'inline-flex items-center justify-center font-medium transition-[background-color,color,box-shadow,filter] duration-150',
    size === 'sm' && 'h-8 gap-1.5 rounded-lg px-3 text-sm',
    size === 'md' && 'h-10 gap-2 rounded-lg px-4 text-base',
    size === 'lg' && 'h-11.5 gap-2 rounded-lg px-5 text-md',
    variant === 'primary' && 'bg-primary text-primary-fg shadow-xs hover:brightness-110',
    variant === 'outline' && 'border border-line bg-surface text-content hover:bg-surface-muted',
    variant === 'ghost' && 'text-content-muted hover:bg-surface-muted hover:text-content',
    className,
  );

  const inner = (
    <>
      {leftIcon}
      {children}
      {rightIcon}
    </>
  );

  return external ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className={classes}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={classes}>
      {inner}
    </Link>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the control has no visible text of its own. */
  label: string;
  children: ReactNode;
}

/** A square, label-less control. The accessible name is mandatory, not optional. */
export function IconButton({ label, children, className, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8.5 w-8.5 items-center justify-center rounded-lg text-content-muted',
        'transition-colors hover:bg-surface-muted hover:text-content',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------- list rows --

/**
 * A row in a compact list panel — top products, low stock, recent activity.
 *
 * Kept as a primitive because these lists appear on five different screens and
 * were drifting apart: different paddings, different hover states, some
 * clickable and some not.
 */
export function ListRow({
  href,
  leading,
  title,
  subtitle,
  trailing,
  className,
  ...props
}: {
  href?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'title' | 'href'>) {
  const inner = (
    <>
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-content">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-xs text-content-subtle">{subtitle}</span>
        )}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </>
  );

  const classes = cn(
    'flex items-center gap-3 rounded-lg px-2 py-2 transition-colors',
    href && 'hover:bg-surface-muted',
    className,
  );

  return href ? (
    <Link href={href} className={classes} {...props}>
      {inner}
    </Link>
  ) : (
    <div className={classes}>{inner}</div>
  );
}

// -------------------------------------------------------------- ordinals --

/**
 * The numbered marker used by setup checklists and the "how it works" rail.
 * Three states, and never colour alone — done carries a tick.
 */
export function StepMarker({
  index,
  state,
}: {
  index: number;
  state: 'done' | 'current' | 'todo';
}) {
  return (
    <span
      className={cn(
        'nums inline-flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        state === 'done' && 'bg-success-500 text-white',
        state === 'current' && 'bg-primary text-primary-fg',
        state === 'todo' && 'border border-line bg-surface text-content-subtle',
      )}
    >
      {state === 'done' ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
          <path
            d="m3.5 8.5 3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        index
      )}
    </span>
  );
}

/** A thin completion bar. Announced as a progressbar, not just drawn as one. */
export function Progress({
  value,
  total,
  label,
  className,
}: {
  value: number;
  total: number;
  label: string;
  className?: string;
}) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={label}
      // An explicit track rather than `bg-surface-muted`: this bar is usually
      // sitting *on* a muted panel header, where that token is invisible.
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-content/10 dark:bg-content/15',
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
