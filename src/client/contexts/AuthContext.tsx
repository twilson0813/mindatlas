import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ACCESS_TOKEN_KEY = 'mindatlas_access_token';
const REFRESH_TOKEN_KEY = 'mindatlas_refresh_token';

function getStoredToken(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStoredToken(key: string, token: string): void {
  try {
    localStorage.setItem(key, token);
  } catch {
    // Storage not available
  }
}

function removeStoredToken(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage not available
  }
}

function decodeTokenPayload(token: string): { sub: string; email: string; exp: number } | null {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const payload = decodeTokenPayload(token);
  if (!payload) return true;
  // Consider expired if less than 60 seconds remaining
  return payload.exp * 1000 < Date.now() + 60_000;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTokens = useCallback(() => {
    removeStoredToken(ACCESS_TOKEN_KEY);
    removeStoredToken(REFRESH_TOKEN_KEY);
    setUser(null);
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback((accessToken: string) => {
    const payload = decodeTokenPayload(accessToken);
    if (!payload) return;

    // Refresh 2 minutes before expiry
    const expiresIn = payload.exp * 1000 - Date.now();
    const refreshIn = Math.max(expiresIn - 120_000, 10_000);

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(async () => {
      try {
        await refreshTokenRequest();
      } catch {
        clearTokens();
      }
    }, refreshIn);
  }, [clearTokens]);

  const refreshTokenRequest = useCallback(async () => {
    const storedRefreshToken = getStoredToken(REFRESH_TOKEN_KEY);
    if (!storedRefreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: storedRefreshToken }),
    });

    if (!response.ok) {
      throw new Error('Token refresh failed');
    }

    const data = await response.json();
    setStoredToken(ACCESS_TOKEN_KEY, data.accessToken);
    if (data.refreshToken) {
      setStoredToken(REFRESH_TOKEN_KEY, data.refreshToken);
    }

    const payload = decodeTokenPayload(data.accessToken);
    if (payload) {
      setUser({ id: payload.sub, email: payload.email });
      scheduleRefresh(data.accessToken);
    }
  }, [scheduleRefresh]);

  // Initialize auth state from stored tokens
  useEffect(() => {
    const initAuth = async () => {
      const accessToken = getStoredToken(ACCESS_TOKEN_KEY);

      if (accessToken && !isTokenExpired(accessToken)) {
        const payload = decodeTokenPayload(accessToken);
        if (payload) {
          setUser({ id: payload.sub, email: payload.email });
          scheduleRefresh(accessToken);
        }
      } else if (getStoredToken(REFRESH_TOKEN_KEY)) {
        try {
          await refreshTokenRequest();
        } catch {
          clearTokens();
        }
      }

      setIsLoading(false);
    };

    initAuth();
  }, [clearTokens, refreshTokenRequest, scheduleRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Login failed');
    }

    const data = await response.json();
    setStoredToken(ACCESS_TOKEN_KEY, data.accessToken);
    setStoredToken(REFRESH_TOKEN_KEY, data.refreshToken);

    const payload = decodeTokenPayload(data.accessToken);
    if (payload) {
      setUser({ id: payload.sub, email: payload.email });
      scheduleRefresh(data.accessToken);
    }
  }, [scheduleRefresh]);

  const register = useCallback(async (email: string, password: string) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Registration failed');
    }

    const data = await response.json();
    setStoredToken(ACCESS_TOKEN_KEY, data.accessToken);
    setStoredToken(REFRESH_TOKEN_KEY, data.refreshToken);

    const payload = decodeTokenPayload(data.accessToken);
    if (payload) {
      setUser({ id: payload.sub, email: payload.email });
      scheduleRefresh(data.accessToken);
    }
  }, [scheduleRefresh]);

  const logout = useCallback(() => {
    clearTokens();
  }, [clearTokens]);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    refreshToken: refreshTokenRequest,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
