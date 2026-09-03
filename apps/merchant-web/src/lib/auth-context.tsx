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
import { useRouter } from 'next/navigation';
import type { AdminSessionResponse, Permission, TenantMembershipSummary } from '@retailos/types';
import { api, getActiveTenantId, setActiveTenantId, tokenStore } from './api';

interface AuthContextValue {
  session: AdminSessionResponse | null;
  loading: boolean;
  activeTenant: TenantMembershipSummary | null;
  isSuperAdmin: boolean;
  permissions: string[];
  /** Checks a permission against the *live* session, not the token. */
  can: (permission: Permission | string) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Session state for the console.
 *
 * On mount it calls `/auth/me` rather than trusting whatever is in
 * localStorage: the server is the authority on who you are and what you may do,
 * and a revoked membership must disappear from the UI on the next load rather
 * than lingering until a token expires.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = useCallback(async () => {
    if (!tokenStore.get()) {
      setSession(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api().auth.me();
      setSession(me);
      // Keep the stored tenant in step with what the server says we may access.
      const stored = getActiveTenantId();
      const valid = me.memberships.some((m) => m.tenantId === stored);
      if (!valid) setActiveTenantId(me.activeTenantId ?? me.memberships[0]?.tenantId ?? null);
    } catch {
      tokenStore.clear();
      setActiveTenantId(null);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api().auth.login({ email, password });
      tokenStore.set({
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
      });
      setActiveTenantId(result.session.activeTenantId);
      setSession(result.session);
    },
    [],
  );

  const logout = useCallback(async () => {
    await api().auth.logout().catch(() => undefined);
    tokenStore.clear();
    setActiveTenantId(null);
    setSession(null);
    router.push('/login');
  }, [router]);

  const switchTenant = useCallback(async (tenantId: string) => {
    const result = await api().auth.switchTenant(tenantId);
    tokenStore.set({
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
    setActiveTenantId(tenantId);
    setSession(result.session);
    // Full reload so every cached query is refetched against the new tenant —
    // showing one store's data under another's name would be worse than a blink.
    window.location.href = '/';
  }, []);

  const activeTenant = useMemo(
    () => session?.memberships.find((m) => m.tenantId === session.activeTenantId) ?? null,
    [session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      activeTenant,
      isSuperAdmin: session?.user.isSuperAdmin ?? false,
      permissions: session?.permissions ?? [],
      can: (permission) =>
        Boolean(session?.user.isSuperAdmin) || (session?.permissions ?? []).includes(permission),
      login,
      logout,
      switchTenant,
      refresh: load,
    }),
    [session, loading, activeTenant, login, logout, switchTenant, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
