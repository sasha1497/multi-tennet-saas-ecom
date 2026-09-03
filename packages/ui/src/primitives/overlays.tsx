'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Locks background scroll while an overlay is open, and restores the exact
 * scroll position afterwards. Without the position restore, closing a modal on
 * iOS jumps the page to the top.
 */
function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const { overflow, paddingRight } = document.body.style;
    // Compensate for the disappearing scrollbar so the layout does not shift.
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [active]);
}

/** Closes on Escape. */
function useEscape(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

/**
 * Traps Tab inside the overlay and returns focus to the trigger on close.
 * This is what makes a modal usable with a keyboard rather than a trap.
 */
function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus() ?? container.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active, ref]);
}

/** Renders into document.body, guarding against SSR where there is no DOM. */
function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

// ------------------------------------------------------------------ modal --

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Set false for destructive flows where a stray click should not dismiss. */
  closeOnBackdrop?: boolean;
}

const MODAL_SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useScrollLock(open);
  useEscape(open, onClose);
  useFocusTrap(open, panelRef);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[1300] flex items-end justify-center sm:items-center">
        <div
          className="absolute inset-0 bg-neutral-950/50 animate-fade-in"
          onClick={closeOnBackdrop ? onClose : undefined}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          tabIndex={-1}
          className={cn(
            'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface-raised shadow-xl',
            'animate-slide-up sm:rounded-2xl',
            MODAL_SIZES[size],
          )}
        >
          {(title || description) && (
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                {title && <h2 className="text-md font-semibold text-content">{title}</h2>}
                {description && (
                  <p className="mt-0.5 text-sm text-content-muted">{description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 rounded-lg p-1.5 text-content-subtle hover:bg-surface-muted hover:text-content"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="scroll-slim flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

// ----------------------------------------------------------------- drawer --

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left';
  width?: string;
}

/** Side panel. Used for filters and detail views that should not lose page context. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = 'right',
  width = 'max-w-md',
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useScrollLock(open);
  useEscape(open, onClose);
  useFocusTrap(open, panelRef);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[1200]">
        <div className="absolute inset-0 bg-neutral-950/50 animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          tabIndex={-1}
          className={cn(
            'absolute inset-y-0 flex w-full flex-col border-line bg-surface-raised shadow-xl',
            side === 'right' ? 'right-0 border-l animate-slide-in-right' : 'left-0 border-r',
            width,
          )}
        >
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            {title && <h2 className="text-md font-semibold text-content">{title}</h2>}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 rounded-lg p-1.5 text-content-subtle hover:bg-surface-muted hover:text-content"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="scroll-slim flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

// ------------------------------------------------------------------ toast --

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  duration?: number;
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside a <ToastProvider>');
  return ctx;
}

const TOAST_ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="h-4.5 w-4.5 text-success-600" />,
  error: <XCircle className="h-4.5 w-4.5 text-danger-600" />,
  info: <Info className="h-4.5 w-4.5 text-info-600" />,
  warning: <AlertTriangle className="h-4.5 w-4.5 text-warning-600" />,
};

/**
 * Toast host.
 *
 * The live region is `polite` for success/info and `assertive` for errors, so a
 * failure interrupts a screen reader while a "Saved" does not.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const duration = t.duration ?? (t.tone === 'error' ? 6000 : 3500);
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      dismiss,
      success: (title, description) => toast({ tone: 'success', title, description }),
      error: (title, description) => toast({ tone: 'error', title, description }),
      info: (title, description) => toast({ tone: 'info', title, description }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[1500] flex w-full max-w-sm flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            aria-live={t.tone === 'error' ? 'assertive' : 'polite'}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface-raised p-3.5 shadow-lg animate-slide-up"
          >
            <span className="mt-px shrink-0">{TOAST_ICONS[t.tone]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-content">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-xs text-content-muted">{t.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-content-subtle hover:text-content"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ----------------------------------------------------- confirmation dialog --

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

/** Used before anything irreversible: archiving a product, cancelling an order. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      closeOnBackdrop={!loading}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-9 rounded-lg border border-line px-3.5 text-sm font-medium text-content hover:bg-surface-muted disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={loading}
            className={cn(
              'h-9 rounded-lg px-3.5 text-sm font-medium text-white disabled:opacity-50',
              destructive ? 'bg-danger-600 hover:bg-danger-700' : 'bg-primary hover:brightness-110',
            )}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {message && <div className="text-sm text-content-muted">{message}</div>}
    </Modal>
  );
}
