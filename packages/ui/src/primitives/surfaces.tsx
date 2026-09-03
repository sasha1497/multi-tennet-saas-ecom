'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `flat` drops the shadow — right for cards sitting inside another panel. */
  variant?: 'raised' | 'flat';
  padded?: boolean;
}

export function Card({ className, variant = 'raised', padded = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface-raised',
        variant === 'raised' && 'shadow-sm',
        padded && 'p-5',
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Removes the bottom hairline when the body supplies its own separation. */
  bare?: boolean;
}

export function CardHeader({ title, description, action, className, bare }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 px-5 py-4',
        !bare && 'border-b border-line',
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="truncate text-md font-semibold text-content">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-content-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 border-t border-line px-5 py-3.5', className)}
      {...props}
    />
  );
}

// ------------------------------------------------------------------ badge --

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  info: 'bg-info-50 text-info-700 dark:bg-info-700/20 dark:text-info-100',
  success: 'bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-100',
  warning: 'bg-warning-50 text-warning-700 dark:bg-warning-700/20 dark:text-warning-100',
  danger: 'bg-danger-50 text-danger-700 dark:bg-danger-700/20 dark:text-danger-100',
  primary: 'bg-primary-soft text-primary',
};

const DOT_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-400',
  info: 'bg-info-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  primary: 'bg-primary',
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  /**
   * Adds a colour dot. The label always carries the meaning — the dot is a
   * secondary cue, never the only signal.
   */
  dot?: boolean;
  size?: 'sm' | 'md';
}

export function Badge({ tone = 'neutral', children, className, dot, size = 'sm' }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot && (
        <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONES[tone])} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

// ----------------------------------------------------------------- avatar --

export interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const AVATAR_SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
};

/** Falls back to initials, so a missing image never leaves an empty hole. */
export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const initials = (name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft font-semibold text-primary',
        AVATAR_SIZES[size],
        className,
      )}
      aria-hidden={!name}
    >
      {src ? (
        <img src={src} alt={name ?? ''} className="h-full w-full object-cover" />
      ) : (
        initials || '?'
      )}
    </span>
  );
}

// --------------------------------------------------------------- skeleton --

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'skeleton-shimmer relative overflow-hidden rounded-md bg-neutral-200/70 dark:bg-neutral-800',
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

/** Convenience: a block of skeleton rows matching a table or list. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 animate-spin text-current', className)}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ----------------------------------------------------------------- states --

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-content-subtle">
          {icon}
        </div>
      )}
      <p className="text-md font-semibold text-content">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-content-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger-50 text-danger-600 dark:bg-danger-700/20">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <p className="text-md font-semibold text-content">{title}</p>
      {message && <p className="mt-1.5 max-w-md text-sm text-content-muted">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-content hover:bg-surface-muted"
        >
          Try again
        </button>
      )}
    </div>
  );
}
