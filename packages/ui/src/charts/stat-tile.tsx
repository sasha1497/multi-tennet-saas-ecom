'use client';

import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../lib/cn';
import { Sparkline } from './bar-list';

export interface StatTileProps {
  label: string;
  /** The headline figure, already formatted (e.g. "₹1,84,637"). */
  value: string;
  /** Percentage change vs the previous window. Null when there is no baseline. */
  changePercent?: number | null;
  trend?: 'up' | 'down' | 'flat';
  /** Describes what the comparison is against, e.g. "vs previous 30 days". */
  comparisonLabel?: string;
  icon?: ReactNode;
  sparkline?: number[];
  /**
   * For metrics where a rise is bad (refunds, failed payments), so the colour
   * matches the *meaning* rather than the direction.
   */
  invertTrendColour?: boolean;
  className?: string;
  href?: string;
}

/**
 * A single headline metric.
 *
 * The data-viz rule that matters here: a lone current value is a **stat tile**,
 * not a one-bar chart. The number is the point; the sparkline is context.
 *
 * The delta never relies on colour alone — it always ships an arrow icon and a
 * text percentage, so the direction survives greyscale, colour-vision
 * deficiency and forced-colors mode.
 */
export function StatTile({
  label,
  value,
  changePercent,
  trend = 'flat',
  comparisonLabel = 'vs previous period',
  icon,
  sparkline,
  invertTrendColour,
  className,
  href,
}: StatTileProps) {
  const isGood = invertTrendColour ? trend === 'down' : trend === 'up';
  const isBad = invertTrendColour ? trend === 'up' : trend === 'down';

  const Wrapper = href ? 'a' : 'div';

  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn(
        'block rounded-xl border border-line bg-surface-raised p-4 shadow-sm transition-shadow',
        href && 'hover:shadow-md',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-content-muted">{label}</p>
        {icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            {icon}
          </span>
        )}
      </div>

      {/* Hero figure: proportional figures, large, in primary ink. */}
      <p className="mt-2 text-3xl font-bold leading-none tracking-tight text-content">{value}</p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {changePercent !== null && changePercent !== undefined ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                isGood && 'text-success-600',
                isBad && 'text-danger-600',
                !isGood && !isBad && 'text-content-muted',
              )}
            >
              {trend === 'up' ? (
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : trend === 'down' ? (
                <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="tabular">
                {changePercent > 0 ? '+' : ''}
                {changePercent}%
              </span>
              <span className="font-normal text-content-subtle">{comparisonLabel}</span>
            </span>
          ) : (
            <span className="text-xs text-content-subtle">{comparisonLabel}</span>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <Sparkline values={sparkline} trend={trend} className="shrink-0" />
        )}
      </div>
    </Wrapper>
  );
}
