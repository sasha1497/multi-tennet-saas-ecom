'use client';

import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface BarListItem {
  label: string;
  value: number;
  /** Rendered instead of the raw number at the row end. */
  display?: string;
  /**
   * Optional semantic dot (order status, health). The **label always carries the
   * meaning** — the dot is a secondary cue and never the sole signal.
   */
  tone?: 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'info';
  href?: string;
  meta?: ReactNode;
}

export interface BarListProps {
  items: BarListItem[];
  className?: string;
  /** Caps the rows shown; the rest fold into a "+N more" line. */
  limit?: number;
  emptyMessage?: string;
}

const TONE_DOTS: Record<NonNullable<BarListItem['tone']>, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  serious: 'var(--status-serious)',
  critical: 'var(--status-critical)',
  neutral: 'var(--status-neutral)',
  info: 'var(--status-info)',
};

/**
 * Horizontal bar list — magnitude comparison across named categories.
 *
 * Used for "orders by status", "revenue by category" and "top products". Chosen
 * over a pie or donut on purpose: a horizontal bar reads long category names
 * without rotation, compares lengths accurately (angles are hard to judge), and
 * scales past the three-or-four slices where a pie stops working.
 *
 * Colour carries no identity here — every bar is the same validated hue and the
 * **row label** identifies the category. That is what keeps it readable for
 * colourblind users and in greyscale print, and it sidesteps the adjacent-hue
 * separation problem entirely.
 *
 * Bars are anchored square at the baseline with a 4px rounded value end, so the
 * eye reads length from a common zero.
 */
export function BarList({ items, className, limit, emptyMessage = 'No data yet' }: BarListProps) {
  if (items.length === 0) {
    return <p className={cn('py-8 text-center text-sm text-content-muted', className)}>{emptyMessage}</p>;
  }

  const shown = limit ? items.slice(0, limit) : items;
  const hidden = limit ? items.length - shown.length : 0;
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className={cn('space-y-2.5', className)}>
      {shown.map((item) => {
        const pct = Math.max(2, (item.value / max) * 100);
        const Row = item.href ? 'a' : 'div';
        return (
          <Row
            key={item.label}
            {...(item.href ? { href: item.href } : {})}
            className={cn('group block', item.href && 'cursor-pointer')}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5">
                {item.tone && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: TONE_DOTS[item.tone] }}
                    aria-hidden="true"
                  />
                )}
                <span className="truncate text-sm text-content group-hover:text-primary">
                  {item.label}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-content tabular">
                {item.display ?? item.value.toLocaleString()}
              </span>
            </div>
            {item.meta && <div className="mb-1 text-xs text-content-muted">{item.meta}</div>}
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-r-[4px] transition-[width] duration-500"
                style={{ width: `${pct}%`, background: 'var(--viz-series-1)' }}
              />
            </div>
          </Row>
        );
      })}
      {hidden > 0 && (
        <p className="pt-1 text-xs text-content-muted">+{hidden} more</p>
      )}
    </div>
  );
}

// -------------------------------------------------------------- sparkline --

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Colours the line by direction. Paired with the tile's arrow + text delta. */
  trend?: 'up' | 'down' | 'flat';
}

/**
 * Tiny trend line for a stat tile.
 *
 * No axes, no labels — it conveys shape, not values, which is exactly its job
 * next to a hero number that carries the precise figure.
 */
export function Sparkline({ values, width = 96, height = 28, className, trend }: SparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - 2) + 1;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return `${x},${y}`;
  });

  const stroke =
    trend === 'up'
      ? 'var(--status-good)'
      : trend === 'down'
        ? 'var(--status-critical)'
        : 'var(--viz-ink-muted)';

  return (
    <svg
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
