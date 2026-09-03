'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';

const CONTROL_BASE =
  'w-full rounded-lg border border-line bg-surface px-3 text-base text-content placeholder:text-content-subtle ' +
  'transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-content-subtle';

export interface FieldProps {
  label?: ReactNode;
  /** Rendered in red below the control and wired up via aria-describedby. */
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children?: ReactNode;
  htmlFor?: string;
}

/**
 * Label + control + error/hint wrapper.
 *
 * Errors are announced with `role="alert"` and linked to the control by
 * `aria-describedby`, so a screen-reader user hears why a submit failed instead
 * of just landing on an unexplained red box.
 */
export function Field({ label, error, hint, required, className, children, htmlFor }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="block text-sm font-medium text-content"
        >
          {label}
          {required && <span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="flex items-start gap-1 text-xs text-danger-600">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-xs text-content-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, containerClassName, label, error, hint, leftIcon, rightSlot, id, required, type, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [revealed, setRevealed] = useState(false);

  const isPassword = type === 'password';
  const effectiveType = isPassword && revealed ? 'text' : type;

  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      required={required}
      htmlFor={inputId}
      className={containerClassName}
    >
      <div className="relative">
        {leftIcon && (
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle"
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          type={effectiveType}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={cn(
            CONTROL_BASE,
            'h-10',
            leftIcon && 'pl-9',
            (rightSlot || isPassword) && 'pr-10',
            error && 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20',
            className,
          )}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-content-subtle hover:text-content"
            aria-label={revealed ? 'Hide password' : 'Show password'}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        {!isPassword && rightSlot && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-content-subtle">
            {rightSlot}
          </span>
        )}
      </div>
    </Field>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, label, error, hint, id, required, rows = 4, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={fieldId}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        className={cn(
          CONTROL_BASE,
          'py-2 leading-relaxed resize-y',
          error && 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20',
          className,
        )}
        {...props}
      />
    </Field>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  options?: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, label, error, hint, options, placeholder, id, required, children, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={fieldId}>
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={cn(
          CONTROL_BASE,
          "h-10 appearance-none bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E\")] bg-[length:20px] bg-[right_0.5rem_center] bg-no-repeat pr-9",
          error && 'border-danger-500',
          className,
        )}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options?.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
        {children}
      </select>
    </Field>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="flex items-start gap-2.5">
      <input
        ref={ref}
        id={fieldId}
        type="checkbox"
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0 rounded border-line text-primary accent-[rgb(var(--color-primary))]',
          'focus:ring-2 focus:ring-primary/30',
          className,
        )}
        {...props}
      />
      {(label || description) && (
        <label htmlFor={fieldId} className="cursor-pointer select-none">
          {label && <span className="block text-sm text-content">{label}</span>}
          {description && <span className="block text-xs text-content-muted">{description}</span>}
        </label>
      )}
    </div>
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}

/** Accessible toggle. Uses `role="switch"` so assistive tech announces on/off. */
export function Switch({ checked, onChange, label, description, disabled, id }: SwitchProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <label htmlFor={fieldId} className="cursor-pointer select-none">
          {label && <span className="block text-sm font-medium text-content">{label}</span>}
          {description && (
            <span className="mt-0.5 block text-xs text-content-muted">{description}</span>
          )}
        </label>
      )}
      <button
        id={fieldId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-neutral-300 dark:bg-neutral-700',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
