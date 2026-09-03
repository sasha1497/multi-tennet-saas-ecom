'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Cart, CustomerProfile, StorefrontBootstrap } from '@retailos/types';
import { useToast } from '@retailos/ui';
import { api, tokenStore } from './api';

interface StoreContextValue {
  bootstrap: StorefrontBootstrap;
  customer: CustomerProfile | null;
  authLoading: boolean;
  cart: Cart | null;
  cartLoading: boolean;
  itemCount: number;
  refreshCart: () => Promise<void>;
  addToCart: (variantId: string, quantity?: number) => Promise<void>;
  updateCartItem: (itemId: string, quantity: number) => Promise<void>;
  removeCartItem: (itemId: string) => Promise<void>;
  applyCoupon: (code: string) => Promise<void>;
  removeCoupon: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    password: string;
  }) => Promise<void>;
  logout: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/**
 * Storefront session: the tenant's configuration, the shopper and their cart.
 *
 * `bootstrap` arrives from the server render — the tenant was already resolved
 * from the Host header there, so the first paint is correct and branded rather
 * than a flash of generic UI.
 */
export function StoreProvider({
  bootstrap,
  children,
}: {
  bootstrap: StorefrontBootstrap;
  children: ReactNode;
}) {
  const toast = useToast();
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cart, setCart] = useState<Cart | null>(null);
  const [cartLoading, setCartLoading] = useState(false);

  const refreshCart = useCallback(async () => {
    try {
      setCart(await api().storefront.getCart());
    } catch {
      // A cart failure must not break browsing.
    }
  }, []);

  // Restore the session and the cart on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (tokenStore.get()) {
        try {
          const session = await api().storefront.profile();
          if (!cancelled) setCustomer(session);
        } catch {
          tokenStore.clear();
        }
      }
      if (!cancelled) setAuthLoading(false);
      await refreshCart();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCart]);

  const addToCart = useCallback(
    async (variantId: string, quantity = 1) => {
      setCartLoading(true);
      try {
        setCart(await api().storefront.addToCart({ variantId, quantity }));
        toast.success('Added to bag');
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Could not add this item',
        );
        throw err;
      } finally {
        setCartLoading(false);
      }
    },
    [toast],
  );

  const updateCartItem = useCallback(
    async (itemId: string, quantity: number) => {
      setCartLoading(true);
      try {
        setCart(await api().storefront.updateCartItem(itemId, quantity));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not update your bag');
      } finally {
        setCartLoading(false);
      }
    },
    [toast],
  );

  const removeCartItem = useCallback(
    async (itemId: string) => {
      setCartLoading(true);
      try {
        setCart(await api().storefront.removeCartItem(itemId));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not remove this item');
      } finally {
        setCartLoading(false);
      }
    },
    [toast],
  );

  const applyCoupon = useCallback(
    async (code: string) => {
      try {
        setCart(await api().storefront.applyCoupon(code));
        toast.success('Coupon applied');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'That coupon did not work');
        throw err;
      }
    },
    [toast],
  );

  const removeCoupon = useCallback(async () => {
    setCart(await api().storefront.removeCoupon());
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const auth = await api().auth.customerLogin({ identifier, password });
      tokenStore.set({
        accessToken: auth.tokens.accessToken,
        refreshToken: auth.tokens.refreshToken,
      });
      setCustomer(auth.customer);
      // Fold anything added while browsing anonymously into the account cart.
      try {
        setCart(await api().storefront.mergeGuestCart());
      } catch {
        await refreshCart();
      }
    },
    [refreshCart],
  );

  const register = useCallback(
    async (input: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      password: string;
    }) => {
      const auth = await api().auth.registerCustomer(input);
      tokenStore.set({
        accessToken: auth.tokens.accessToken,
        refreshToken: auth.tokens.refreshToken,
      });
      setCustomer(auth.customer);
      try {
        setCart(await api().storefront.mergeGuestCart());
      } catch {
        await refreshCart();
      }
    },
    [refreshCart],
  );

  const logout = useCallback(() => {
    void api().auth.logout().catch(() => undefined);
    tokenStore.clear();
    setCustomer(null);
    void refreshCart();
  }, [refreshCart]);

  const value = useMemo<StoreContextValue>(
    () => ({
      bootstrap,
      customer,
      authLoading,
      cart,
      cartLoading,
      itemCount: cart?.totals.itemCount ?? 0,
      refreshCart,
      addToCart,
      updateCartItem,
      removeCartItem,
      applyCoupon,
      removeCoupon,
      login,
      register,
      logout,
    }),
    [
      bootstrap,
      customer,
      authLoading,
      cart,
      cartLoading,
      refreshCart,
      addToCart,
      updateCartItem,
      removeCartItem,
      applyCoupon,
      removeCoupon,
      login,
      register,
      logout,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
