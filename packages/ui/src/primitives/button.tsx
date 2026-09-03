'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg hover:brightness-110 active:brightness-95 shadow-xs disabled:hover:brightness-100',
  secondary:
    'bg-neutral-100 text-content hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700',
  outline:
    'border border-line bg-surface text-content hover:bg-surface-muted',
  ghost: 'text-content-muted hover:bg-surface-muted hover:text-content',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 shadow-xs',
  link: 'text-primary underline-offset-4 hover:underline p-0 h-auto',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-md',
  md: 'h-10 px-4 text-base gap-2 rounded-lg',
  lg: 'h-11 px-5 text-md gap-2 rounded-lg',
  icon: 'h-9 w-9 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks interaction. Width is preserved to avoid layout shift. */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

/**
 * The one button.
 *
 * `loading` disables the button *and* keeps its label in place (at zero opacity)
 * so the row does not jump when an action starts — a small thing that makes
 * repeated admin actions feel much steadier.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex items-center justify-center font-medium transition-[background-color,color,box-shadow,filter] duration-150',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && (
        <Loader2 className="absolute h-4 w-4 animate-spin" aria-hidden="true" />
      )}
      <span
        className={cn(
          'inline-flex items-center justify-center gap-[inherit]',
          loading && 'opacity-0',
        )}
      >
        {leftIcon}
        {children}
        {rightIcon}
      </span>
    </button>
  );
});
