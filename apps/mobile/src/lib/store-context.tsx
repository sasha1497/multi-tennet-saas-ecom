import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Alert } from 'react-native';
import type { Cart, CustomerProfile, StorefrontBootstrap } from '@retailos/types';
import {
  api,
  getActiveTenantSlug,
  loadPersistedTenant,
  resetApiClient,
  setActiveTenantSlug,
  tokenStore,
} from './api';

interface StoreContextValue {
  /** Null until a store has been chosen — the app opens on tenant discovery. */
  bootstrap: StorefrontBootstrap | null;
  tenantSlug: string | null;
  booting: boolean;
  customer: CustomerProfile | null;
  cart: Cart | null;
  itemCount: number;

  selectStore: (slug: string) => Promise<boolean>;
  leaveStore: () => Promise<void>;

  refreshCart: () => Promise<void>;
  addToCart: (variantId: string, quantity?: number) => Promise<void>;
  updateCartItem: (itemId: string, quantity: number) => Promise<void>;
  removeCartItem: (itemId: string) => Promise<void>;
  applyCoupon: (code: string) => Promise<void>;

  login: (identifier: string, password: string) => Promise<void>;
  register: (input: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/**
 * App-wide state: which store the shopper is in, who they are, and their cart.
 *
 * The mobile app is genuinely multi-tenant — one binary that can open any
 * merchant's shop. The chosen store is persisted, so the app reopens where the
 * shopper left off, and switching stores resets the session because a customer
 * account belongs to exactly one merchant.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<StorefrontBootstrap | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);

  const refreshCart = useCallback(async () => {
    if (!getActiveTenantSlug()) return;
    try {
      setCart(await api().storefront.getCart());
    } catch {
      // A cart failure must not block browsing.
    }
  }, []);

  const loadStore = useCallback(
    async (slug: string): Promise<boolean> => {
      await setActiveTenantSlug(slug);
      resetApiClient();
      try {
        const data = await api().storefront.bootstrap();
        setBootstrap(data);
        setTenantSlug(slug);
        await refreshCart();
        return true;
      } catch {
        await setActiveTenantSlug(null);
        resetApiClient();
        return false;
      }
    },
    [refreshCart],
  );

  // Reopen the last store, and restore the session if there is one.
  useEffect(() => {
    (async () => {
      const saved = await loadPersistedTenant();
      if (saved) {
        const ok = await loadStore(saved);
        if (ok && (await tokenStore.get())) {
          try {
            setCustomer(await api().storefront.profile());
          } catch {
            await tokenStore.clear();
          }
        }
      }
      setBooting(false);
    })();
  }, [loadStore]);

  const selectStore = useCallback(
    async (slug: string) => {
      const ok = await loadStore(slug.trim().toLowerCase());
      if (!ok) {
        Alert.alert('Store not found', `We could not find a shop called “${slug}”.`);
      }
      return ok;
    },
    [loadStore],
  );

  const leaveStore = useCallback(async () => {
    // Switching merchants means a different customer identity entirely.
    await tokenStore.clear();
    await setActiveTenantSlug(null);
    resetApiClient();
    setBootstrap(null);
    setTenantSlug(null);
    setCustomer(null);
    setCart(null);
  }, []);

  const addToCart = useCallback(
    async (variantId: string, quantity = 1) => {
      setCart(await api().storefront.addToCart({ variantId, quantity }));
    },
    [],
  );

  const updateCartItem = useCallback(async (itemId: string, quantity: number) => {
    setCart(await api().storefront.updateCartItem(itemId, quantity));
  }, []);

  const removeCartItem = useCallback(async (itemId: string) => {
    setCart(await api().storefront.removeCartItem(itemId));
  }, []);

  const applyCoupon = useCallback(async (code: string) => {
    setCart(await api().storefront.applyCoupon(code));
  }, []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const auth = await api().auth.customerLogin({ identifier, password });
      await tokenStore.set({
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

  const register = useCallback(
    async (input: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
      password: string;
    }) => {
      const auth = await api().auth.registerCustomer(input);
      await tokenStore.set({
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

  const logout = useCallback(async () => {
    await api().auth.logout().catch(() => undefined);
    await tokenStore.clear();
    setCustomer(null);
    await refreshCart();
  }, [refreshCart]);

  const value = useMemo<StoreContextValue>(
    () => ({
      bootstrap,
      tenantSlug,
      booting,
      customer,
      cart,
      itemCount: cart?.totals.itemCount ?? 0,
      selectStore,
      leaveStore,
      refreshCart,
      addToCart,
      updateCartItem,
      removeCartItem,
      applyCoupon,
      login,
      register,
      logout,
    }),
    [
      bootstrap,
      tenantSlug,
      booting,
      customer,
      cart,
      selectStore,
      leaveStore,
      refreshCart,
      addToCart,
      updateCartItem,
      removeCartItem,
      applyCoupon,
      login,
      register,
      logout,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
