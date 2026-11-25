import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiRequest,
  getAuthToken,
  registerUnauthorizedHandler,
  setAuthToken,
} from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    try {
      if (getAuthToken()) {
        await apiRequest('/auth/logout', { method: 'POST' });
      }
    } catch {
      // Ignore network errors on logout cleanup
    } finally {
      setAuthToken('');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      setAuthToken('');
      setUser(null);
    });

    async function hydrateSession() {
      if (!getAuthToken()) {
        setLoading(false);
        return;
      }
      try {
        const res = await apiRequest('/auth/me');
        setUser(res.user);
      } catch {
        setAuthToken('');
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    hydrateSession();
  }, []);

  const login = async (email, password) => {
    const res = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const value = {
    user,
    loading,
    login,
    logout,
    isAdmin: user?.role === 'admin',
    isManagerOrAdmin: user?.role === 'admin' || user?.role === 'manager',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
