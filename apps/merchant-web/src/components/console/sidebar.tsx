'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  Building2,
  Check,
  ChevronsUpDown,
  ExternalLink,
  LayoutDashboard,
  PanelLeft,
  PanelLeftClose,
  X,
} from 'lucide-react';
import { cn } from '@retailos/ui';
import { useAuth } from '@/lib/auth-context';
import { Logo } from './logo';
import {
  NAV_SECTIONS,
  PLATFORM_SECTIONS,
  isNavItemActive,
  type NavItem,
  type NavSection,
} from './nav';

/* ---------------------------------------------------------------------------
 * The navigation rail.
 *
 * Ink, in both themes. A dark rail against a light workspace is the console's
 * strongest structural cue: it separates "where I am in the product" from "what
 * I am working on" without a single divider, and it stays the anchor when the
 * canvas flips to dark rather than inverting along with it.
 *
 * The rail also owns *context* — which store you are acting on — because that
 * is an identity question, not a page-level one. The topbar is then free to be
 * about the page you are actually on.
 * ------------------------------------------------------------------------- */

export interface SidebarProps {
  /** Icon-only rail. Labels become tooltips; group titles become rules. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Supplied only by the mobile drawer, which needs its own dismiss control. */
  onDismiss?: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, onDismiss }: SidebarProps) {
  const pathname = usePathname();
  const { session, activeTenant, isSuperAdmin, can } = useAuth();

  const onPlatform = pathname.startsWith('/platform');

  /**
   * A platform super admin belongs to no store, and a merchant can lose their
   * last membership. Either way every merchant route has no tenant to act on, so
   * the store sections are hidden rather than offered as links that can only 403.
   */
  const hasNoStore =
    Boolean(session) && !session?.activeTenantId && session?.memberships.length === 0;

  const sections: NavSection[] = onPlatform ? PLATFORM_SECTIONS : NAV_SECTIONS;

  return (
    <nav
      aria-label="Main"
      className="flex h-full flex-col bg-rail text-rail-fg"
      data-collapsed={collapsed || undefined}
    >
      {/* ---------------------------------------------------------- brand -- */}
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b border-rail-line',
          collapsed ? 'justify-center px-2' : 'gap-2.5 px-4',
        )}
      >
        <Link
          href={onPlatform ? '/platform' : '/dashboard'}
          className="flex min-w-0 items-center gap-2.5 rounded-lg"
          aria-label="RetailOS console home"
        >
          <Logo className="h-7 w-7 shrink-0" />
          {!collapsed && (
            <span className="truncate text-md font-semibold tracking-[-0.015em] text-rail-fg">
              RetailOS
            </span>
          )}
        </Link>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto rounded-lg p-1.5 text-rail-muted transition-colors hover:bg-rail-raised hover:text-rail-fg lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* --------------------------------------------------------- context -- */}
      {!onPlatform && !hasNoStore && session && session.memberships.length > 0 && (
        <div className={cn('shrink-0 border-b border-rail-line', collapsed ? 'p-2' : 'p-3')}>
          <StoreSwitcher collapsed={collapsed} />
        </div>
      )}

      {onPlatform && !collapsed && (
        <div className="shrink-0 border-b border-rail-line px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-label text-rail-subtle">
            Signed in as
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-rail-fg">
            <Building2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Platform administrator
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------ nav -- */}
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
        {hasNoStore && !onPlatform ? null : (
          sections.map((section, i) => {
            const visible = section.items.filter(
              (item) => !item.permission || can(item.permission),
            );
            if (visible.length === 0) return null;
            return (
              <div key={section.title} className={cn(i > 0 && (collapsed ? 'mt-2' : 'mt-5'))}>
                {collapsed ? (
                  i > 0 && <div className="mx-2 mb-2 h-px bg-rail-line" />
                ) : (
                  <p className="px-2.5 pb-1.5 text-2xs font-semibold uppercase tracking-label text-rail-subtle">
                    {section.title}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {visible.map((item) => (
                    <li key={item.href}>
                      <RailLink
                        item={item}
                        active={isNavItemActive(item, pathname)}
                        collapsed={collapsed}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}

        {/* Cross-links between the two surfaces a super admin moves between. */}
        {isSuperAdmin && (
          <div className={cn(collapsed ? 'mt-2' : 'mt-5')}>
            {collapsed ? (
              <div className="mx-2 mb-2 h-px bg-rail-line" />
            ) : (
              <p className="px-2.5 pb-1.5 text-2xs font-semibold uppercase tracking-label text-rail-subtle">
                Switch surface
              </p>
            )}
            <RailShortcut
              href={onPlatform ? '/dashboard' : '/platform'}
              label={onPlatform ? 'Store console' : 'Platform admin'}
              icon={onPlatform ? LayoutDashboard : Building2}
              collapsed={collapsed}
            />
          </div>
        )}
      </div>

      {/* --------------------------------------------------------- footer -- */}
      <div className="shrink-0 border-t border-rail-line p-2.5">
        {activeTenant && !onPlatform && (
          <RailTooltip label="Open your live storefront" disabled={!collapsed}>
            <a
              href={activeTenant.storefrontUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                'group flex items-center rounded-lg py-2 text-sm text-rail-muted transition-colors hover:bg-rail-raised hover:text-rail-fg',
                collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5',
              )}
            >
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">View storefront</span>}
            </a>
          </RailTooltip>
        )}

        {/* Desktop only: the drawer is dismissed, never collapsed. */}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-pressed={collapsed}
          className={cn(
            'hidden w-full items-center rounded-lg py-2 text-sm text-rail-muted transition-colors hover:bg-rail-raised hover:text-rail-fg lg:flex',
            collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5',
          )}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          {!collapsed && <span className="truncate">Collapse</span>}
          <span className="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
        </button>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ links --

function RailLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <RailTooltip label={item.label} disabled={!collapsed}>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex items-center rounded-lg py-2 text-base font-medium transition-colors duration-100',
          collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5',
          active
            ? 'bg-rail-raised text-rail-fg'
            : 'text-rail-muted hover:bg-rail-raised/60 hover:text-rail-fg',
        )}
      >
        {/* The active marker is a bar, not just a fill — it survives greyscale. */}
        {active && (
          <span
            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-iris-400"
            aria-hidden="true"
          />
        )}
        <Icon
          className={cn('h-4.5 w-4.5 shrink-0', active ? 'text-iris-300' : 'text-current')}
          aria-hidden="true"
        />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    </RailTooltip>
  );
}

function RailShortcut({
  href,
  label,
  icon: Icon,
  collapsed,
}: {
  href: string;
  label: string;
  icon: NavItem['icon'];
  collapsed: boolean;
}) {
  return (
    <RailTooltip label={label} disabled={!collapsed}>
      <Link
        href={href}
        className={cn(
          'flex items-center rounded-lg py-2 text-base font-medium text-rail-muted transition-colors hover:bg-rail-raised/60 hover:text-rail-fg',
          collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5',
        )}
      >
        <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    </RailTooltip>
  );
}

/**
 * Tooltip for the collapsed rail.
 *
 * CSS-only, and shown on focus as well as hover — an icon-only rail is unusable
 * from the keyboard otherwise. `aria-hidden` on the bubble keeps screen readers
 * on the link's own accessible name instead of hearing the label twice.
 */
function RailTooltip({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (disabled) return <>{children}</>;
  return (
    <span className="group/tip relative block">
      {children}
      <span
        role="presentation"
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-full top-1/2 z-[1500] ml-2 -translate-y-1/2 whitespace-nowrap',
          'rounded-lg bg-rail-raised px-2.5 py-1.5 text-xs font-medium text-rail-fg shadow-lg',
          'opacity-0 transition-opacity duration-100',
          'group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
        )}
      >
        {label}
      </span>
    </span>
  );
}

// -------------------------------------------------------------- switcher --

/**
 * Which store am I acting on.
 *
 * A plain label when there is only one membership — a dropdown that can only
 * ever show its own entry is a control that lies about being useful. With more
 * than one it becomes a real menu, and switching does a full reload (see
 * `auth-context`) so no cached query can render one store's data under another's
 * name.
 */
function StoreSwitcher({ collapsed }: { collapsed: boolean }) {
  const { session, activeTenant, switchTenant } = useAuth();
  const [open, setOpen] = useState(false);

  if (!session) return null;

  const current = activeTenant ?? session.memberships[0] ?? null;
  if (!current) return null;

  const multiple = session.memberships.length > 1;
  const initials = current.tenantName.slice(0, 2).toUpperCase();

  const mark = (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-iris-500/25 text-2xs font-bold uppercase text-iris-200">
      {initials}
    </span>
  );

  if (collapsed) {
    return (
      <RailTooltip label={current.tenantName}>
        <Link
          href="/store"
          className="flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-rail-raised"
        >
          {mark}
          <span className="sr-only">{current.tenantName} — store design</span>
        </Link>
      </RailTooltip>
    );
  }

  if (!multiple) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
        {mark}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-rail-fg">
            {current.tenantName}
          </span>
          <span className="block truncate text-2xs text-rail-subtle">
            {current.tenantStatus === 'ACTIVE'
              ? current.role.toLowerCase()
              : current.tenantStatus.toLowerCase()}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-rail-raised"
      >
        {mark}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-rail-fg">
            {current.tenantName}
          </span>
          <span className="block truncate text-2xs text-rail-subtle">
            {session.memberships.length} stores
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-rail-subtle" aria-hidden="true" />
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[1300] cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close store menu"
            tabIndex={-1}
          />
          <ul
            role="listbox"
            aria-label="Switch store"
            className="absolute left-0 right-0 top-full z-[1400] mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-rail-line bg-rail-raised p-1 shadow-xl animate-scale-in"
          >
            {session.memberships.map((m) => {
              const selected = m.tenantId === current.tenantId;
              return (
                <li key={m.tenantId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setOpen(false);
                      if (!selected) void switchTenant(m.tenantId);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-rail-fg">
                        {m.tenantName}
                      </span>
                      <span className="block truncate text-2xs text-rail-subtle">
                        {m.tenantSlug} · {m.role.toLowerCase()}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-iris-300" aria-hidden="true" />
                    ) : (
                      <ArrowLeftRight
                        className="h-3.5 w-3.5 shrink-0 text-rail-subtle"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
