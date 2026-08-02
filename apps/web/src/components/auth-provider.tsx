'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAccessToken } from '@/lib/api';

export interface Me {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  coins: number;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  permissions: string[];
  unreadNotifications: number;
  roles: { role: { key: string; name: string; color: string; weight: number } }[];
  minecraft: { uuid: string; ign: string; verifiedAt: string | null } | null;
  stats: {
    kills: number;
    deaths: number;
    maxHearts: number;
    heartsStolen: number;
    playtimeMinutes: number;
    bestStreak: number;
  } | null;
  renders: { head: string; body: string; cape: string } | null;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ twoFactorRequired: boolean; challengeToken?: string }>;
  completeTwoFactor: (challengeToken: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      setUser(await api<Me>('/me'));
    } catch {
      setUser(null);
    }
  }, []);

  /**
   * On mount there is no access token in memory — it never survived the page
   * load, by design. The refresh cookie does, so one silent rotation restores
   * the session without the user seeing a flash of the signed-out state.
   */
  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ accessToken: string }>('/auth/refresh', {
          method: 'POST',
          retryOnExpiry: false,
        });
        setAccessToken(data.accessToken);
        await loadUser();
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadUser]);

  const signIn = useCallback<AuthState['signIn']>(
    async (email, password) => {
      const data = await api<{ accessToken?: string; twoFactorRequired?: boolean; challengeToken?: string }>(
        '/auth/login',
        { method: 'POST', body: { email, password }, retryOnExpiry: false },
      );

      if (data.twoFactorRequired) {
        return { twoFactorRequired: true, challengeToken: data.challengeToken };
      }

      setAccessToken(data.accessToken ?? null);
      await loadUser();
      return { twoFactorRequired: false };
    },
    [loadUser],
  );

  const completeTwoFactor = useCallback<AuthState['completeTwoFactor']>(
    async (challengeToken, code) => {
      const data = await api<{ accessToken: string }>('/auth/2fa/verify', {
        method: 'POST',
        body: { challengeToken, code },
        retryOnExpiry: false,
      });
      setAccessToken(data.accessToken);
      await loadUser();
    },
    [loadUser],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const can = useCallback(
    (permission: string) => {
      if (!user) return false;
      if (user.permissions.includes('*') || user.permissions.includes(permission)) return true;
      const parts = permission.split('.');
      for (let i = parts.length - 1; i > 0; i--) {
        if (user.permissions.includes(`${parts.slice(0, i).join('.')}.*`)) return true;
      }
      return false;
    },
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, loading, signIn, completeTwoFactor, signOut, refresh: loadUser, can }),
    [user, loading, signIn, completeTwoFactor, signOut, loadUser, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
