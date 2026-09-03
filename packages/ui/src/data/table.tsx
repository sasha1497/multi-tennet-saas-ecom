'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { cn } from '../lib/cn';
import { EmptyState, Skeleton } from '../primitives/surfaces';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Receives the row and its index. */
  cell: (row: T, index: number) => ReactNode;
  /** Enables the sort control in the header; the parent owns the sort state. */
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
  /** Hidden below `md` — used to keep dense tables readable on a tablet. */
  hideBelowMd?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Rendered when there are no rows and we are not loading. */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  className?: string;
  /** Sticky header for long scrolling tables. */
  stickyHeader?: boolean;
}

/**
 * The admin table.
 *
 * Three states are first-class rather than afterthoughts — loading (skeleton
 * rows that match the real row height, so nothing jumps), empty (an explanation
 * and usually an action), and populated. A table that silently renders nothing
 * is the most common way an admin screen looks broken when it is merely empty.
 *
 * The wrapper scrolls horizontally on its own so a wide table never forces the
 * whole page sideways.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  sortBy,
  sortOrder,
  onSort,
  className,
  stickyHeader,
}: DataTableProps<T>) {
  const alignClass = (align?: Column<T>['align']) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  if (!loading && rows.length === 0) {
    return (
      <div className={className}>
        {empty ?? <EmptyState title="Nothing here yet" description="No records match this view." />}
      </div>
    );
  }

  return (
    <div className={cn('scroll-slim w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
          <tr className="border-b border-line bg-surface-muted">
            {columns.map((col) => {
              const active = sortBy === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-content-muted',
                    alignClass(col.align),
                    col.hideBelowMd && 'hidden md:table-cell',
                    col.headerClassName,
                  )}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded hover:text-content',
                        active && 'text-content',
                      )}
                    >
                      {col.header}
                      {active ? (
                        sortOrder === 'asc' ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronDown className="h-3 w-3 opacity-30" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn('px-4 py-3', col.hideBelowMd && 'hidden md:table-cell')}
                    >
                      <Skeleton className="h-4 w-full max-w-[140px]" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, index) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-line last:border-0 transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-surface-muted',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-4 py-3 text-sm text-content',
                        alignClass(col.align),
                        col.hideBelowMd && 'hidden md:table-cell',
                        col.className,
                      )}
                    >
                      {col.cell(row, index)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------- pagination --

export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  className,
}: PaginationProps) {
  if (totalPages <= 1) {
    return total > 0 ? (
      <div className={cn('px-4 py-3 text-xs text-content-muted', className)}>
        {total} {total === 1 ? 'record' : 'records'}
      </div>
    ) : null;
  }

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3',
        className,
      )}
    >
      <p className="text-xs text-content-muted tabular">
        Showing <span className="font-medium text-content">{from}</span>–
        <span className="font-medium text-content">{to}</span> of{' '}
        <span className="font-medium text-content">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-sm text-content hover:bg-surface-muted disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Previous</span>
        </button>
        {pageWindow(page, totalPages).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-1.5 text-content-subtle">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={cn(
                'h-8 min-w-8 rounded-lg px-2 text-sm tabular',
                p === page
                  ? 'bg-primary font-semibold text-primary-fg'
                  : 'text-content hover:bg-surface-muted',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-sm text-content hover:bg-surface-muted disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}

/**
 * Page numbers with ellipses: 1 … 4 [5] 6 … 20.
 * Keeps the control a fixed width no matter how many pages there are.
 */
function pageWindow(page: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const pages: (number | null)[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) pages.push(null);
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < totalPages - 1) pages.push(null);
  pages.push(totalPages);

  return pages;
}
