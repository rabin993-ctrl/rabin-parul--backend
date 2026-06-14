import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { Platform } from 'react-native';
import {
  apiRequest,
  configureApiSession,
  setApiAccessToken,
} from '../api/client';
import {
  clearRefreshToken,
  readRefreshToken,
  writeRefreshToken,
} from '../api/sessionStorage';
import type { AuthResponse, OwnerProfile, TokenPair } from '../api/types';

type AuthContextValue = {
  ready: boolean;
  accountId: string | null;
  profile: OwnerProfile | null;
  authenticated: boolean;
  onboardingComplete: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; displayName: string }) => Promise<void>;
  completeUsername: (username: string) => Promise<void>;
  reloadProfile: () => Promise<OwnerProfile>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function deviceName(): string {
  if (Platform.OS === 'web') return 'Parul Web';
  if (Platform.OS === 'ios') return 'Parul iOS';
  return 'Parul Android';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [profile, setProfile] = useState<OwnerProfile | null>(null);

  const clearSession = useCallback(async () => {
    setApiAccessToken(null);
    setAccountId(null);
    setProfile(null);
    await clearRefreshToken();
  }, []);

  const storeTokens = useCallback(async (tokens: TokenPair) => {
    setApiAccessToken(tokens.accessToken);
    await writeRefreshToken(tokens.refreshToken);
  }, []);

  const refresh = useCallback(async (): Promise<string | null> => {
    const refreshToken = await readRefreshToken();
    if (!refreshToken) return null;
    try {
      const result = await apiRequest<{ tokens: TokenPair }>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        authenticated: false,
      });
      await storeTokens(result.tokens);
      return result.tokens.accessToken;
    } catch {
      await clearSession();
      return null;
    }
  }, [clearSession, storeTokens]);

  const reloadProfile = useCallback(async () => {
    const result = await apiRequest<OwnerProfile>('/me/profile');
    setAccountId(result.profile.id);
    setProfile(result);
    return result;
  }, []);

  useEffect(() => configureApiSession({
    refresh,
    onInvalidSession: () => {
      void clearSession();
    },
  }), [clearSession, refresh]);

  useEffect(() => {
    let active = true;
    (async () => {
      const token = await refresh();
      if (token && active) {
        try {
          await reloadProfile();
        } catch {
          await clearSession();
        }
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [clearSession, refresh, reloadProfile]);

  const applyAuthResponse = useCallback(async (result: AuthResponse) => {
    await storeTokens(result.tokens);
    setAccountId(result.account.id);
    await reloadProfile();
  }, [reloadProfile, storeTokens]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      authenticated: false,
      body: { email: email.trim(), password, deviceName: deviceName() },
    });
    await applyAuthResponse(result);
  }, [applyAuthResponse]);

  const register = useCallback(async (input: {
    email: string;
    password: string;
    displayName: string;
  }) => {
    const result = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      authenticated: false,
      body: {
        email: input.email.trim(),
        password: input.password,
        displayName: input.displayName.trim(),
        deviceName: deviceName(),
      },
    });
    await applyAuthResponse(result);
  }, [applyAuthResponse]);

  const completeUsername = useCallback(async (username: string) => {
    await apiRequest('/me/username', {
      method: 'PUT',
      body: { username: username.trim() },
    });
    await reloadProfile();
  }, [reloadProfile]);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      await clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => ({
    ready,
    accountId,
    profile,
    authenticated: accountId != null,
    onboardingComplete: profile?.onboarding.status === 'complete',
    login,
    register,
    completeUsername,
    reloadProfile,
    logout,
  }), [
    ready, accountId, profile, login, register, completeUsername, reloadProfile, logout,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
