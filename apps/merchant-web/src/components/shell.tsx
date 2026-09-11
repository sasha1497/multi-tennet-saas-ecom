'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@retailos/ui';
import { CommandPalette, useCommandPaletteShortcut } from './console/command-palette';
import { Sidebar } from './console/sidebar';
import { Topbar } from './console/topbar';

const THEME_KEY = 'retailos.theme';
const COLLAPSED_KEY = 'retailos.console.railCollapsed';

/**
 * The console frame.
 *
 * Three pieces, each with one job: an ink rail that carries navigation and
 * store context, a topbar that carries the current page and everything you can
 * reach from anywhere, and the workspace itself. The frame owns the state those
 * three share — theme, rail width, palette visibility — and nothing else.
 *
 * Permission filtering lives in the rail. That is a usability choice, not a
 * security one: the API enforces the same rules regardless of what renders, and
 * a link that can only ever 403 is worse than no link.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  /**
   * Restore both preferences before the shell's first meaningful paint.
   *
   * Every read is guarded: Safari's private mode throws on `localStorage`
   * rather than returning null, and a console that will not render because a
   * preference could not be read is a bad trade for a remembered rail width.
   */
  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY) as 'light' | 'dark' | null;
      const initial =
        savedTheme ??
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      setTheme(initial);
      document.documentElement.dataset.theme = initial;

      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch {
      /* Defaults are already correct. */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* The choice simply will not survive a reload. */
      }
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ditto */
      }
      return next;
    });
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandPaletteShortcut(openPalette);

  // Close the mobile drawer on navigation — otherwise it covers the page you
  // just asked for.
  useEffect(() => setDrawerOpen(false), [pathname]);

  // The drawer is a modal surface; the page behind it must not scroll under it.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen bg-surface-muted">
      {/* -------------------------------------------------- desktop rail -- */}
      <aside
        className={cn(
          'hidden shrink-0 lg:block',
          'transition-[width] duration-200 ease-out motion-reduce:transition-none',
          collapsed ? 'w-rail-collapsed' : 'w-rail',
        )}
      >
        <div className="sticky top-0 h-screen">
          <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        </div>
      </aside>

      {/* -------------------------------------------------- mobile drawer -- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[1200] lg:hidden">
          <div
            className="absolute inset-0 bg-neutral-950/50 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-[17rem] max-w-[85vw] shadow-xl animate-slide-in-right">
            <Sidebar
              collapsed={false}
              onToggleCollapsed={toggleCollapsed}
              onDismiss={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- workspace -- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenNav={() => setDrawerOpen(true)}
          onOpenPalette={openPalette}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <main
          id="main"
          className="canvas-grid min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8"
        >
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
