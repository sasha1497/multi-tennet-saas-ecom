'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BadgePercent,
  BarChart3,
  Boxes,
  Building2,
  ChevronDown,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  Moon,
  Package,
  Palette,
  Settings,
  ShoppingCart,
  Star,
  Sun,
  Tags,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { Permission } from '@retailos/types';
import { Avatar, Badge, Dropdown, cn } from '@retailos/ui';
import { useAuth } from '@/lib/auth-context';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hidden when the signed-in user lacks this permission. */
  permission?: Permission;
  /** Hidden when the tenant's plan does not include this feature. */
  feature?: string;
  exact?: boolean;
}

const NAV_SECTIONS: { title: string | null; items: NavItem[] }[] = [
  {
    title: null,
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard, permission: Permission.REPORTS_READ, exact: true },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { href: '/products', label: 'Products', icon: Package, permission: Permission.PRODUCTS_READ },
      { href: '/categories', label: 'Categories', icon: Tags, permission: Permission.CATEGORIES_READ },
      { href: '/inventory', label: 'Inventory', icon: Boxes, permission: Permission.INVENTORY_READ },
    ],
  },
  {
    title: 'Sell',
    items: [
      { href: '/orders', label: 'Orders', icon: ShoppingCart, permission: Permission.ORDERS_READ },
      { href: '/customers', label: 'Customers', icon: Users, permission: Permission.CUSTOMERS_READ },
      { href: '/coupons', label: 'Coupons', icon: BadgePercent, permission: Permission.COUPONS_READ },
      { href: '/reviews', label: 'Reviews', icon: Star, permission: Permission.REVIEWS_READ },
    ],
  },
  {
    title: 'Store',
    items: [
      { href: '/reports', label: 'Reports', icon: BarChart3, permission: Permission.REPORTS_READ },
      { href: '/store', label: 'Store design', icon: Palette, permission: Permission.STORE_DESIGN },
      { href: '/staff', label: 'Team', icon: UsersRound, permission: Permission.STAFF_READ },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const PLATFORM_ITEMS: NavItem[] = [
  { href: '/platform', label: 'Tenants', icon: Building2, exact: true },
  { href: '/platform/system', label: 'System', icon: BarChart3 },
];

/**
 * The console frame: sidebar, top bar, store switcher and theme toggle.
 *
 * Navigation is filtered by the *live* permission set, so a MANAGER never sees a
 * Team link that would 403 on click. That is a usability choice, not a security
 * one — the API enforces the same rules regardless of what the sidebar renders.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session, activeTenant, isSuperAdmin, can, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Restore the saved theme before first paint of the shell.
  useEffect(() => {
    const saved = (localStorage.getItem('retailos.theme') as 'light' | 'dark' | null) ?? null;
    const initial =
      saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('retailos.theme', next);
  };

  // Close the mobile drawer when the route changes.
  useEffect(() => setMobileOpen(false), [pathname]);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const onPlatform = pathname.startsWith('/platform');

  const sidebar = (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-fg">
          R
        </span>
        <span className="truncate text-sm font-semibold text-content">RetailOS</span>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="ml-auto rounded-lg p-1.5 text-content-subtle hover:bg-surface-muted lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="scroll-slim flex-1 overflow-y-auto px-3 py-4">
        {onPlatform ? (
          <>
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-content-subtle">
              Platform
            </p>
            {PLATFORM_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item)} />
            ))}
            <div className="my-3 h-px bg-line" />
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-content-muted hover:bg-surface-muted hover:text-content"
            >
              <LayoutDashboard className="h-4 w-4" />
              Back to store console
            </Link>
          </>
        ) : (
          NAV_SECTIONS.map((section, i) => {
            const visible = section.items.filter((item) => !item.permission || can(item.permission));
            if (visible.length === 0) return null;
            return (
              <div key={i} className={cn(i > 0 && 'mt-5')}>
                {section.title && (
                  <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-subtle">
                    {section.title}
                  </p>
                )}
                <div className="space-y-0.5">
                  {visible.map((item) => (
                    <NavLink key={item.href} item={item} active={isActive(item)} />
                  ))}
                </div>
              </div>
            );
          })
        )}

        {isSuperAdmin && !onPlatform && (
          <div className="mt-5">
            <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-subtle">
              Platform
            </p>
            <Link
              href="/platform"
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-content-muted hover:bg-surface-muted hover:text-content"
            >
              <Building2 className="h-4 w-4" />
              Super admin
            </Link>
          </div>
        )}
      </div>

      {activeTenant && !onPlatform && (
        <div className="shrink-0 border-t border-line p-3">
          <a
            href={activeTenant.storefrontUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2 rounded-lg bg-surface-muted px-2.5 py-2 text-xs text-content-muted hover:text-content"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">View storefront</span>
          </a>
        </div>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface-raised lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[1200] lg:hidden">
          <div
            className="absolute inset-0 bg-neutral-950/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface-raised animate-slide-in-right">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[1100] flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-raised/95 px-4 backdrop-blur">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-1.5 text-content-muted hover:bg-surface-muted lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Store switcher — only rendered when there is more than one store. */}
          {session && session.memberships.length > 0 && !onPlatform && <StoreSwitcher />}
          {onPlatform && (
            <span className="flex items-center gap-2 text-sm font-semibold text-content">
              <Building2 className="h-4 w-4 text-primary" />
              Platform administration
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg p-2 text-content-muted hover:bg-surface-muted hover:text-content"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <Dropdown
              align="right"
              trigger={
                <span className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-surface-muted">
                  <Avatar name={session?.user.fullName} size="sm" />
                  <span className="hidden text-sm font-medium text-content sm:block">
                    {session?.user.firstName}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-content-subtle" />
                </span>
              }
              items={[
                { label: session?.user.email ?? '', disabled: true },
                { label: 'Account settings', href: '/settings', icon: <Settings className="h-4 w-4" />, separated: true },
                {
                  label: 'Sign out',
                  onClick: () => void logout(),
                  icon: <LogOut className="h-4 w-4" />,
                  destructive: true,
                  separated: true,
                },
              ]}
            />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary-soft text-primary'
          : 'text-content-muted hover:bg-surface-muted hover:text-content',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function StoreSwitcher() {
  const { session, activeTenant, switchTenant } = useAuth();
  if (!session) return null;

  const others = session.memberships.filter((m) => m.tenantId !== activeTenant?.tenantId);

  if (session.memberships.length === 1) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold text-content">
          {activeTenant?.tenantName ?? session.memberships[0].tenantName}
        </span>
        {activeTenant && activeTenant.tenantStatus !== 'ACTIVE' && (
          <Badge tone="warning" dot>
            {activeTenant.tenantStatus.toLowerCase()}
          </Badge>
        )}
      </span>
    );
  }

  return (
    <Dropdown
      align="left"
      trigger={
        <span className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-surface-muted">
          <span className="truncate text-sm font-semibold text-content">
            {activeTenant?.tenantName ?? 'Select a store'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-content-subtle" />
        </span>
      }
      items={[
        { label: 'Switch store', disabled: true },
        ...others.map((m) => ({
          label: (
            <span className="flex flex-col">
              <span className="text-sm">{m.tenantName}</span>
              <span className="text-[11px] text-content-subtle">
                {m.tenantSlug} · {m.role.toLowerCase()}
              </span>
            </span>
          ),
          onClick: () => void switchTenant(m.tenantId),
        })),
      ]}
    />
  );
}
