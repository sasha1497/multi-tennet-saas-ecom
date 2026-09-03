'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';

export interface AreaPoint {
  /** ISO date (YYYY-MM-DD) or any short label. */
  date: string;
  value: number;
}

export interface AreaChartProps {
  data: AreaPoint[];
  /** Formats the y-axis ticks and the tooltip value. */
  formatValue?: (value: number) => string;
  formatDate?: (date: string) => string;
  /** Optional secondary number shown in the tooltip, e.g. order count. */
  secondary?: { label: string; values: number[] };
  height?: number;
  className?: string;
  /** Accessible name. A single-series chart needs no legend — this names it. */
  label?: string;
}

const PAD = { top: 12, right: 8, bottom: 24, left: 52 };

/**
 * Revenue-over-time area chart.
 *
 * Deliberately hand-drawn SVG rather than a charting library: it is ~150 lines,
 * ships no extra bytes, and gives exact control over the things that actually
 * make a chart readable — a recessive grid, a 2px line, one validated hue, and a
 * crosshair that snaps to the nearest real data point.
 *
 * Design decisions, all from the data-viz rules:
 *   • **One series, one hue.** Trend over time with a single measure is a
 *     sequential job, so there is no categorical palette and nothing to confuse
 *     under colour-vision deficiency. The hue is validated ≥3:1 on both surfaces.
 *   • **No legend.** With one series the title carries the identity.
 *   • **Zero-filled days.** The API returns a row per day including quiet ones,
 *     so a slow week reads as a flat line rather than a compressed axis.
 *   • **Hover by default.** An SVG chart in a browser is interactive; the
 *     crosshair + tooltip is the layer that makes individual values readable
 *     without labelling every point.
 */
export function AreaChart({
  data,
  formatValue = (v) => String(v),
  formatDate = (d) => d,
  secondary,
  height = 260,
  className,
  label = 'Revenue over time',
}: AreaChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [width, setWidth] = useState(720);

  const wrapRef = useRef<HTMLDivElement>(null);

  // Track the container width so the chart is genuinely responsive rather than
  // relying on `preserveAspectRatio`, which would distort the type. Measured in
  // a layout effect so the first paint is already at the right size.
  useIsomorphicLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    const innerW = Math.max(80, width - PAD.left - PAD.right);
    const innerH = Math.max(60, height - PAD.top - PAD.bottom);

    const values = data.map((d) => d.value);
    const rawMax = Math.max(...values, 0);
    // Round the ceiling up to a friendly number so tick labels are readable.
    const max = niceCeiling(rawMax);
    const ticks = [0, max * 0.25, max * 0.5, max * 0.75, max];

    const x = (i: number) =>
      PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (max === 0 ? 0 : (v / max) * innerH);

    const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ');
    const area =
      data.length > 0
        ? `${line} L${x(data.length - 1)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`
        : '';

    return { innerW, innerH, max, ticks, x, y, line, area, baseline: PAD.top + innerH };
  }, [data, width, height]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (data.length === 0) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = e.clientX - rect.left - PAD.left;
    const ratio = Math.max(0, Math.min(1, relX / geom.innerW));
    setHoverIndex(Math.round(ratio * (data.length - 1)));
  };

  const active = hoverIndex !== null ? data[hoverIndex] : null;

  if (data.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-sm text-content-muted', className)}
        style={{ height }}
      >
        No data for this period
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={cn('relative w-full', className)}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        role="img"
        aria-label={`${label}. ${data.length} data points, peak ${formatValue(Math.max(...data.map((d) => d.value)))}.`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        className="block touch-none"
      >
        {/* Recessive grid: hairlines that guide the eye without competing with data. */}
        {geom.ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={geom.y(t)}
              y2={geom.y(t)}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={geom.y(t) + 4}
              textAnchor="end"
              className="tabular"
              fontSize={11}
              fill="var(--viz-ink-muted)"
            >
              {formatValue(t)}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id="retailos-area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--viz-series-1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--viz-series-1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <path d={geom.area} fill="url(#retailos-area-fill)" />
        <path
          d={geom.line}
          fill="none"
          stroke="var(--viz-series-1)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Crosshair + emphasised point on hover. */}
        {active && hoverIndex !== null && (
          <g pointerEvents="none">
            <line
              x1={geom.x(hoverIndex)}
              x2={geom.x(hoverIndex)}
              y1={PAD.top}
              y2={geom.baseline}
              stroke="var(--viz-axis)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {/* 2px surface ring keeps the marker legible over the fill. */}
            <circle
              cx={geom.x(hoverIndex)}
              cy={geom.y(active.value)}
              r={5}
              fill="var(--viz-series-1)"
              stroke="rgb(var(--color-surface-raised))"
              strokeWidth={2}
            />
          </g>
        )}

        {/* Sparse x labels — first, middle and last only, so they never collide. */}
        {[0, Math.floor((data.length - 1) / 2), data.length - 1]
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .map((i) => (
            <text
              key={i}
              x={geom.x(i)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
              fontSize={11}
              fill="var(--viz-ink-muted)"
            >
              {formatDate(data[i].date)}
            </text>
          ))}
      </svg>

      {active && hoverIndex !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-[128px] -translate-x-1/2 rounded-lg border border-line bg-surface-raised px-2.5 py-2 shadow-lg"
          style={{
            left: Math.min(Math.max(geom.x(hoverIndex), 70), width - 70),
            top: Math.max(geom.y(active.value) - 66, 0),
          }}
        >
          <p className="text-[11px] text-content-muted">{formatDate(active.date)}</p>
          <p className="text-sm font-semibold text-content tabular">{formatValue(active.value)}</p>
          {secondary && (
            <p className="text-[11px] text-content-muted tabular">
              {secondary.values[hoverIndex] ?? 0} {secondary.label}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** `useLayoutEffect` warns during SSR; fall back to `useEffect` on the server. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Rounds a maximum up to 1/2/5 × 10^n so axis ticks land on readable numbers. */
function niceCeiling(value: number): number {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}
