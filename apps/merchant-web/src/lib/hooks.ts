'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isApiClientError } from '@retailos/api-client';
import { useToast } from '@retailos/ui';

/**
 * Debounces a value — used for search boxes so typing does not fire a request
 * per keystroke.
 */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Keeps list filters in the URL.
 *
 * Means a filtered view is shareable and survives a refresh or a back button —
 * the difference between "send me the pending orders" working and not.
 */
export function useQueryParams<T extends Record<string, string | undefined>>(defaults: T) {
  const router = useRouter();
  const params = useSearchParams();

  const values = { ...defaults } as T;
  for (const key of Object.keys(defaults)) {
    const fromUrl = params.get(key);
    if (fromUrl !== null) (values as Record<string, string>)[key] = fromUrl;
  }

  const setParams = useCallback(
    (next: Partial<Record<keyof T, string | undefined>>) => {
      const search = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === '') search.delete(key);
        else search.set(key, String(value));
      }
      // Changing any filter resets paging; staying on page 7 of a new filter is
      // almost always wrong and usually shows an empty table.
      if (!('page' in next)) search.delete('page');
      router.replace(`?${search.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return [values, setParams] as const;
}

/**
 * Turns any thrown error into a toast with a useful message.
 *
 * Field-level validation errors are summarised rather than dumped, and a
 * server error surfaces its request id so it can be traced in the logs.
 */
export function useErrorToast() {
  const toast = useToast();
  return useCallback(
    (err: unknown, fallback = 'Something went wrong') => {
      if (isApiClientError(err)) {
        const fields = Object.values(err.fieldErrors);
        toast.error(
          err.message || fallback,
          fields.length > 0
            ? fields.join(' · ')
            : err.isServer && err.requestId
              ? `Reference: ${err.requestId}`
              : undefined,
        );
        return;
      }
      toast.error(fallback, 'Check your connection and try again.');
    },
    [toast],
  );
}

/** Formats rupee input (a decimal string) into integer paise for the API. */
export function rupeesToPaise(input: string | number): number {
  const value = typeof input === 'number' ? input : Number.parseFloat(input);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** Formats integer paise back into a plain decimal string for a number input. */
export function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}
