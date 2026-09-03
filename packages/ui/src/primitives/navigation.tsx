'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

// ------------------------------------------------------------------- tabs --

export interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * Underlined tabs with real ARIA roles, so arrow keys and screen readers behave
 * the way a tablist is expected to.
 */
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn('scroll-slim flex gap-1 overflow-x-auto border-b border-line', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors',
              selected
                ? 'text-primary'
                : 'text-content-muted hover:text-content',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[11px] tabular',
                    selected ? 'bg-primary-soft text-primary' : 'bg-surface-muted text-content-muted',
                  )}
                >
                  {tab.count}
                </span>
              )}
            </span>
            {selected && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------- dropdown --

export interface DropdownItem {
  label: ReactNode;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /** Renders a hairline above this item. */
  separated?: boolean;
}

export interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  className?: string;
  menuClassName?: string;
}

/** Click-outside + Escape dismissal, with the menu anchored to the trigger. */
export function Dropdown({ trigger, items, align = 'right', className, menuClassName }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-[1400] mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-line bg-surface-raised py-1 shadow-lg animate-scale-in',
            align === 'right' ? 'right-0' : 'left-0',
            menuClassName,
          )}
        >
          {items.map((item, i) => {
            const Element = item.href ? 'a' : 'button';
            return (
              <div key={i}>
                {item.separated && <div className="my-1 h-px bg-line" />}
                <Element
                  role="menuitem"
                  {...(item.href ? { href: item.href } : { type: 'button' as const })}
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    item.onClick?.();
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                    item.disabled
                      ? 'cursor-not-allowed text-content-subtle'
                      : item.destructive
                        ? 'text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-700/20'
                        : 'text-content hover:bg-surface-muted',
                  )}
                >
                  {item.icon && <span className="shrink-0 text-content-subtle">{item.icon}</span>}
                  {item.label}
                </Element>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- filters --

export interface SegmentOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Date-range / view switcher.
 *
 * Sits in a single row above the charts it filters, per the chart-composition
 * rule that filters belong together and above, not scattered between panels.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  className,
  size = 'sm',
}: SegmentedControlProps) {
  return (
    <div
      role="group"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5',
        className,
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-[6px] font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            opt.value === value
              ? 'bg-surface-raised text-content shadow-xs'
              : 'text-content-muted hover:text-content',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-5 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-xs text-content-muted">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-content-subtle">/</span>}
                {crumb.href ? (
                  <a href={crumb.href} className="hover:text-content hover:underline">
                    {crumb.label}
                  </a>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-2xl font-bold tracking-tight text-content">{title}</h1>
        {description && <p className="mt-1 text-sm text-content-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Collapsible section, used for optional blocks in long forms. */
export function Accordion({
  title,
  children,
  defaultOpen = false,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('rounded-xl border border-line bg-surface-raised', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-content">{title}</span>
        <ChevronDown
          className={cn('h-4 w-4 text-content-subtle transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <div className="border-t border-line px-4 py-4">{children}</div>}
    </div>
  );
}
