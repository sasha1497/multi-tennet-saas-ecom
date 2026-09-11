'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  CornerDownLeft,
  ExternalLink,
  Loader2,
  Package,
  Plus,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { Permission } from '@retailos/types';
import { cn } from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { NAV_SECTIONS, PLATFORM_SECTIONS } from './nav';

/* ---------------------------------------------------------------------------
 * Command palette.
 *
 * Everything in here is real: it navigates to routes that exist and searches
 * products through the same endpoint the Products page uses. There is no
 * "global search" pretending to cover orders and customers as well, because the
 * API has no such endpoint and a search box that silently ignores two thirds of
 * what you type is worse than not offering it.
 * ------------------------------------------------------------------------- */

interface Entry {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: string;
  /** Exactly one of these. */
  href?: string;
  externalHref?: string;
  run?: () => void;
  keywords?: string[];
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { can, activeTenant, isSuperAdmin } = useAuth();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Reset on every open: a palette that remembers last night's query is a bug.
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Next frame, so the input exists before we reach for it.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  /**
   * Product lookup.
   *
   * Only fires past two characters and only for users who may read products —
   * the same permission the Products page is gated behind, so the palette can
   * never surface a row its owner would be 403'd from opening.
   */
  const canSearchProducts = can(Permission.PRODUCTS_READ);
  const trimmed = query.trim();
  const productQuery = useQuery({
    queryKey: ['palette-products', trimmed],
    queryFn: () => api().merchant.products({ search: trimmed, limit: 5 }),
    enabled: open && canSearchProducts && trimmed.length >= 2,
    staleTime: 30_000,
  });

  const navEntries = useMemo<Entry[]>(() => {
    const sections = isSuperAdmin ? [...NAV_SECTIONS, ...PLATFORM_SECTIONS] : NAV_SECTIONS;
    return sections.flatMap((section) =>
      section.items
        .filter((item) => !item.permission || can(item.permission))
        .map<Entry>((item) => ({
          id: `nav:${item.href}`,
          label: item.label,
          hint: item.hint,
          icon: item.icon,
          group: section.title === 'Platform' ? 'Platform' : 'Go to',
          href: item.href,
          keywords: item.keywords,
        })),
    );
  }, [can, isSuperAdmin]);

  const actionEntries = useMemo<Entry[]>(() => {
    const entries: Entry[] = [];
    if (can(Permission.PRODUCTS_CREATE)) {
      entries.push({
        id: 'action:new-product',
        label: 'Add a product',
        hint: 'Create a new catalogue entry',
        icon: Plus,
        group: 'Actions',
        href: '/products/new',
        keywords: ['create', 'new', 'item'],
      });
    }
    if (activeTenant?.storefrontUrl) {
      entries.push({
        id: 'action:storefront',
        label: 'View storefront',
        hint: activeTenant.storefrontUrl.replace(/^https?:\/\//, ''),
        icon: ExternalLink,
        group: 'Actions',
        externalHref: activeTenant.storefrontUrl,
        keywords: ['shop', 'live', 'preview', 'open'],
      });
    }
    return entries;
  }, [can, activeTenant]);

  const productEntries = useMemo<Entry[]>(
    () =>
      (productQuery.data?.items ?? []).map<Entry>((product) => ({
        id: `product:${product.id}`,
        label: product.name,
        hint: [product.categoryName, product.brandName].filter(Boolean).join(' · ') || 'Product',
        icon: Package,
        group: 'Products',
        href: `/products/${product.id}`,
      })),
    [productQuery.data],
  );

  /** Static entries are filtered locally; product hits are already a search result. */
  const results = useMemo(() => {
    const needle = trimmed.toLowerCase();
    const matches = (entry: Entry) =>
      needle.length === 0 ||
      entry.label.toLowerCase().includes(needle) ||
      entry.hint?.toLowerCase().includes(needle) ||
      entry.keywords?.some((k) => k.includes(needle));

    return [
      ...actionEntries.filter(matches),
      ...navEntries.filter(matches),
      ...productEntries,
    ];
  }, [trimmed, actionEntries, navEntries, productEntries]);

  // A shrinking result list must never leave the cursor pointing past the end.
  useEffect(() => {
    setCursor((c) => (c >= results.length ? 0 : c));
  }, [results.length]);

  const select = useCallback(
    (entry: Entry | undefined) => {
      if (!entry) return;
      onOpenChange(false);
      if (entry.href) router.push(entry.href);
      else if (entry.externalHref) window.open(entry.externalHref, '_blank', 'noopener,noreferrer');
      else entry.run?.();
    },
    [onOpenChange, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (results.length === 0 ? 0 : (c + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (results.length === 0 ? 0 : (c - 1 + results.length) % results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select(results[cursor]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  let lastGroup: string | null = null;

  return (
    <div
      className="fixed inset-0 z-[1600] flex items-start justify-center p-4 pt-[12vh]"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-neutral-950/40 backdrop-blur-[2px] animate-fade-in"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-xl animate-scale-in"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          {productQuery.isFetching ? (
            <Loader2 className="h-4.5 w-4.5 shrink-0 animate-spin text-content-subtle" aria-hidden="true" />
          ) : (
            <Search className="h-4.5 w-4.5 shrink-0 text-content-subtle" aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder={
              canSearchProducts ? 'Search pages and products…' : 'Search pages…'
            }
            aria-label="Search pages, actions and products"
            aria-controls="command-results"
            className="h-13 w-full bg-transparent text-md text-content outline-none placeholder:text-content-subtle"
          />
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-2xs font-medium text-content-subtle sm:block">
            Esc
          </kbd>
        </div>

        <ul
          ref={listRef}
          id="command-results"
          role="listbox"
          aria-label="Results"
          className="scroll-slim max-h-[52vh] overflow-y-auto p-2"
        >
          {results.length === 0 && (
            <li className="px-3 py-10 text-center text-sm text-content-muted">
              {productQuery.isFetching ? 'Searching…' : `Nothing matches “${trimmed}”.`}
            </li>
          )}

          {results.map((entry, i) => {
            const Icon = entry.icon;
            const newGroup = entry.group !== lastGroup;
            lastGroup = entry.group;
            const active = i === cursor;
            return (
              <li key={entry.id}>
                {newGroup && (
                  <p className="eyebrow px-3 pb-1 pt-3 first:pt-1">{entry.group}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-active={active}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => select(entry)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                    active ? 'bg-primary-soft' : 'hover:bg-surface-muted',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      active ? 'text-primary' : 'text-content-subtle',
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-base font-medium',
                        active ? 'text-primary' : 'text-content',
                      )}
                    >
                      {entry.label}
                    </span>
                    {entry.hint && (
                      <span className="block truncate text-xs text-content-subtle">
                        {entry.hint}
                      </span>
                    )}
                  </span>
                  {active && (
                    <CornerDownLeft
                      className="h-3.5 w-3.5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-muted px-4 py-2 text-2xs text-content-subtle">
          <span className="flex items-center gap-3">
            <span>
              <kbd className="font-sans font-semibold">↑ ↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-sans font-semibold">↵</kbd> open
            </span>
          </span>
          {!canSearchProducts && <span>Pages only — you cannot view products</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * The ⌘K / Ctrl-K binding, kept separate so the shell can own the open state.
 *
 * Ignored while focus is in a text field, so typing "k" into a product name
 * never swallows the keystroke into a dialog.
 */
export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      onOpen();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen]);
}
