import {
  Boxes,
  ChartNoAxesCombined,
  LayoutDashboard,
  Package,
  Palette,
  Search,
  ShoppingBag,
  Star,
  Tags,
  Users,
} from 'lucide-react';
import { cn } from '@retailos/ui';
import { Logo } from '@/components/console/logo';

/* ---------------------------------------------------------------------------
 * Product visuals for the marketing page.
 *
 * These are built from the console's own tokens and its own rail, panel and
 * stat-card geometry, so what a visitor sees here is what they get after
 * signing up — not a stock illustration of somebody else's dashboard.
 *
 * They are static by design: no queries, no state, no fake live data. The
 * figures are plainly a sample of one shop's month, and they sit inside an
 * obvious browser frame so nobody mistakes them for their own numbers.
 * ------------------------------------------------------------------------- */

/** The browser frame everything is shown inside. */
export function BrowserFrame({
  address,
  children,
  className,
}: {
  address: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-xl',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line bg-surface-muted px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
        </span>
        <span className="mx-auto flex max-w-[60%] items-center gap-1.5 truncate rounded-md bg-surface px-2.5 py-1 text-2xs text-content-subtle">
          {address}
        </span>
      </div>
      {children}
    </div>
  );
}

const RAIL_GROUPS: { title: string; items: { label: string; icon: typeof Package }[] }[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard },
      { label: 'Analytics', icon: ChartNoAxesCombined },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { label: 'Products', icon: Package },
      { label: 'Categories', icon: Tags },
      { label: 'Inventory', icon: Boxes },
    ],
  },
  {
    title: 'Selling',
    items: [
      { label: 'Orders', icon: ShoppingBag },
      { label: 'Customers', icon: Users },
      { label: 'Reviews', icon: Star },
    ],
  },
  {
    title: 'Storefront',
    items: [{ label: 'Design', icon: Palette }],
  },
];

/** Sample figures for one illustrative month. Fixed, so the page never shifts. */
const SAMPLE_STATS = [
  { label: 'Revenue', value: '₹4,82,600', delta: '+18.2%', up: true },
  { label: 'Orders', value: '318', delta: '+9.4%', up: true },
  { label: 'Customers', value: '164', delta: '+12.7%', up: true },
  { label: 'Average order', value: '₹1,517', delta: '−2.1%', up: false },
];

/** A month of revenue, as a normalised 0–1 series. Shape only; no claim attached. */
const SAMPLE_SERIES = [
  0.22, 0.3, 0.26, 0.38, 0.34, 0.46, 0.42, 0.52, 0.48, 0.58, 0.55, 0.64, 0.6, 0.69, 0.74, 0.68,
  0.78, 0.83, 0.79, 0.88, 0.85, 0.93, 0.9, 1,
];

const SAMPLE_ORDERS = [
  { id: 'RO-2418', customer: 'Ananya Iyer', status: 'Delivered', tone: 'success', total: '₹3,240' },
  { id: 'RO-2417', customer: 'Rahul Verma', status: 'Packed', tone: 'info', total: '₹1,899' },
  { id: 'RO-2416', customer: 'Meera Joshi', status: 'Pending', tone: 'warning', total: '₹2,450' },
  { id: 'RO-2415', customer: 'Karthik Nair', status: 'Delivered', tone: 'success', total: '₹899' },
];

const STATUS_CLASSES: Record<string, string> = {
  success: 'bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-100',
  info: 'bg-info-50 text-info-700 dark:bg-info-700/20 dark:text-info-100',
  warning: 'bg-warning-50 text-warning-700 dark:bg-warning-700/20 dark:text-warning-100',
};

/**
 * The console, in miniature.
 *
 * `compact` drops the rail's lower groups and the orders table so the same
 * component can carry a hero at 1100px and a feature card at 420px.
 */
export function ConsolePreview({ compact = false }: { compact?: boolean }) {
  const groups = compact ? RAIL_GROUPS.slice(0, 2) : RAIL_GROUPS;

  return (
    <div className="flex h-full min-h-[380px] bg-surface-muted" aria-hidden="true">
      {/* ------------------------------------------------------------ rail -- */}
      <div className="hidden w-44 shrink-0 flex-col bg-rail py-3 sm:flex">
        <div className="flex items-center gap-2 px-3.5 pb-3">
          <Logo className="h-6 w-6" />
          <span className="text-base font-semibold text-rail-fg">RetailOS</span>
        </div>
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg bg-rail-raised px-2 py-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-iris-500/25 text-[9px] font-bold text-iris-200">
            KZ
          </span>
          <span className="truncate text-2xs font-semibold text-rail-fg">KickZone</span>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-2">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="px-2 pb-1 text-[9px] font-semibold uppercase tracking-label text-rail-subtle">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.label === 'Dashboard';
                  return (
                    <div
                      key={item.label}
                      className={cn(
                        'relative flex items-center gap-2 rounded-md px-2 py-1.5 text-2xs font-medium',
                        active ? 'bg-rail-raised text-rail-fg' : 'text-rail-muted',
                      )}
                    >
                      {active && (
                        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-iris-400" />
                      )}
                      <Icon
                        className={cn('h-3 w-3 shrink-0', active ? 'text-iris-300' : '')}
                      />
                      <span className="truncate">{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------- workspace -- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface-raised px-3.5">
          <span className="text-2xs font-semibold text-content">Dashboard</span>
          <span className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[9px] text-content-subtle">
            <Search className="h-2.5 w-2.5" />
            Search…
          </span>
          <span className="h-5 w-5 rounded-full bg-primary-soft" />
        </div>

        <div className="min-h-0 flex-1 space-y-3 p-3.5">
          <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4')}>
            {(compact ? SAMPLE_STATS.slice(0, 2) : SAMPLE_STATS).map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-line bg-surface-raised p-2.5"
              >
                <p className="text-[9px] font-semibold uppercase tracking-label text-content-subtle">
                  {stat.label}
                </p>
                <p className="nums mt-1.5 text-md font-semibold leading-none text-content">
                  {stat.value}
                </p>
                <p
                  className={cn(
                    'nums mt-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-semibold',
                    stat.up
                      ? 'bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-100'
                      : 'bg-danger-50 text-danger-700 dark:bg-danger-700/20 dark:text-danger-100',
                  )}
                >
                  {stat.delta}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-line bg-surface-raised p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-2xs font-semibold text-content">Revenue</p>
              <p className="text-[9px] text-content-subtle">Last 30 days</p>
            </div>
            <SampleAreaChart />
          </div>

          {!compact && (
            <div className="hidden rounded-lg border border-line bg-surface-raised md:block">
              <div className="border-b border-line px-3 py-2">
                <p className="text-2xs font-semibold text-content">Recent orders</p>
              </div>
              <table className="w-full">
                <tbody>
                  {SAMPLE_ORDERS.map((order) => (
                    <tr key={order.id} className="border-b border-line last:border-0">
                      <td className="nums px-3 py-1.5 text-[10px] font-medium text-primary">
                        {order.id}
                      </td>
                      <td className="px-3 py-1.5 text-[10px] text-content-muted">
                        {order.customer}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                            STATUS_CLASSES[order.tone],
                          )}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="nums px-3 py-1.5 text-right text-[10px] font-medium text-content">
                        {order.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The spark inside the preview. Plain SVG — no chart library on a landing page. */
function SampleAreaChart() {
  const width = 320;
  const height = 64;
  const points = SAMPLE_SERIES.map((v, i) => {
    const x = (i / (SAMPLE_SERIES.length - 1)) * width;
    const y = height - v * (height - 6) - 3;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="preview-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--color-primary))" stopOpacity="0.22" />
          <stop offset="100%" stopColor="rgb(var(--color-primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#preview-fill)" />
      <path
        d={line}
        fill="none"
        stroke="rgb(var(--color-primary))"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * A storefront card for the template gallery.
 *
 * Renders each design's actual swatch trio and typographic personality from the
 * template registry, so the gallery moves in step with the real catalogue rather
 * than being a set of screenshots that rot.
 */
export function TemplateThumb({
  swatches,
  name,
  heading,
}: {
  swatches: readonly [string, string, string];
  name: string;
  heading: string;
}) {
  const [primary, accent, surface] = swatches;

  /**
   * Several designs are built on a near-black ground, and their primary is dark
   * too — drawing the wordmark in `primary` on `surface` made those thumbnails
   * read as blank. Ink is chosen against the actual surface instead, which is
   * the only way this stays correct as designs are added to the registry.
   */
  const onDark = isDark(surface);
  const ink = onDark ? '#ffffff' : primary;

  return (
    <div
      className="relative aspect-[4/3] w-full overflow-hidden rounded-lg"
      style={{ backgroundColor: surface }}
      aria-hidden="true"
    >
      {/* header rail */}
      <div className="flex items-center justify-between px-3 pt-3">
        <span
          className="text-[9px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: ink }}
        >
          {name}
        </span>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 w-3.5 rounded-full"
              style={{ backgroundColor: ink, opacity: 0.35 }}
            />
          ))}
        </span>
      </div>

      {/* hero band */}
      <div
        className="mx-3 mt-2.5 flex h-[42%] flex-col justify-center rounded px-3"
        style={{ backgroundColor: primary }}
      >
        <span
          className="block h-1.5 w-3/5 rounded-full"
          style={{ backgroundColor: isDark(primary) ? '#ffffff' : surface, opacity: 0.9 }}
        />
        <span
          className="mt-1.5 block h-1 w-2/5 rounded-full"
          style={{ backgroundColor: isDark(primary) ? '#ffffff' : surface, opacity: 0.5 }}
        />
        <span className="mt-2.5 block h-2.5 w-14 rounded-sm" style={{ backgroundColor: accent }} />
      </div>

      {/* product row */}
      <div className="mx-3 mt-2.5 grid grid-cols-3 gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1">
            <span
              className="block h-7 w-full rounded-sm"
              style={{ backgroundColor: ink, opacity: onDark ? 0.14 : 0.12 }}
            />
            <span
              className="block h-1 w-2/3 rounded-full"
              style={{ backgroundColor: ink, opacity: 0.35 }}
            />
          </div>
        ))}
      </div>

      <span className="sr-only">{heading}</span>
    </div>
  );
}

/**
 * Relative luminance of a `#rrggbb` swatch, thresholded.
 *
 * Deliberately the simple sRGB weighting rather than a full WCAG computation:
 * the only decision it drives is white-or-brand ink on a decorative thumbnail,
 * and the swatches in the registry are never borderline.
 */
function isDark(hex: string): boolean {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}
