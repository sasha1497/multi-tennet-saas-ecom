'use client';

import { usePathname } from 'next/navigation';
import { ChevronDown, LogOut, Menu, Moon, Search, Settings, Sun } from 'lucide-react';
import { Avatar, Dropdown, cn } from '@retailos/ui';
import { useAuth } from '@/lib/auth-context';
import { IconButton } from './primitives';
import { NAV_SECTIONS, PLATFORM_SECTIONS, allNavItems, isNavItemActive } from './nav';

/* ---------------------------------------------------------------------------
 * The topbar.
 *
 * The rail answers "which store am I in"; this bar answers "which page am I on
 * and what can I reach from here". Keeping those two questions on two different
 * pieces of chrome is what stopped the old header from being a mostly-empty
 * strip with a store name in it.
 *
 * Nothing here is decorative. There is no notification bell, because the API
 * has no notifications to ring — a bell that never lights up is a lie about the
 * product, and one that lights up with invented data is worse.
 * ------------------------------------------------------------------------- */

export interface TopbarProps {
  onOpenNav: () => void;
  onOpenPalette: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function Topbar({ onOpenNav, onOpenPalette, theme, onToggleTheme }: TopbarProps) {
  const pathname = usePathname();
  const { session, logout } = useAuth();

  const onPlatform = pathname.startsWith('/platform');
  const current = allNavItems(onPlatform ? PLATFORM_SECTIONS : NAV_SECTIONS).find((item) =>
    isNavItemActive(item, pathname),
  );

  return (
    <header
      className={cn(
        'sticky top-0 z-[1100] flex h-14 shrink-0 items-center gap-2 px-3 sm:px-5',
        'border-b border-line bg-surface-raised/85 backdrop-blur-md supports-[backdrop-filter]:bg-surface-raised/75',
      )}
    >
      <button
        type="button"
        onClick={onOpenNav}
        className="-ml-1 rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-muted hover:text-content lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Where you are. The rail shows it too; this is the confirmation you read
          when you arrive, and the only cue at all once the rail is collapsed. */}
      <p className="min-w-0 truncate text-md font-semibold text-content">
        {current?.label ?? (onPlatform ? 'Platform' : 'Console')}
      </p>

      {/* ------------------------------------------------------------ search -- */}
      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          'group ml-auto flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-left',
          'text-content-subtle transition-colors hover:border-primary/40 hover:text-content-muted',
          'w-9 justify-center md:w-64 md:justify-start',
        )}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 truncate text-base md:block">Search…</span>
        <kbd className="hidden shrink-0 rounded border border-line bg-surface-muted px-1.5 py-0.5 font-sans text-2xs font-medium md:block">
          ⌘K
        </kbd>
        <span className="sr-only md:hidden">Search pages, actions and products</span>
      </button>

      <div className="flex items-center gap-1">
        <IconButton
          label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
        </IconButton>

        <Dropdown
          align="right"
          menuClassName="min-w-[220px]"
          trigger={
            <span className="flex items-center gap-2 rounded-lg p-1 pr-1.5 transition-colors hover:bg-surface-muted">
              <Avatar name={session?.user.fullName} size="sm" />
              <ChevronDown className="h-3.5 w-3.5 text-content-subtle" aria-hidden="true" />
            </span>
          }
          items={[
            {
              label: (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-content">
                    {session?.user.fullName}
                  </span>
                  <span className="truncate text-2xs text-content-subtle">
                    {session?.user.email}
                  </span>
                </span>
              ),
              disabled: true,
            },
            {
              label: 'Account settings',
              href: '/settings',
              icon: <Settings className="h-4 w-4" />,
              separated: true,
            },
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
  );
}
