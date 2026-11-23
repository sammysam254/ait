import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { ApiService } from '../services/api';
import { supabase } from '../services/supabase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password?: string) => Promise<any>;
  register: (email: string, password: string, fullName: string, companyName?: string, inviteToken?: string) => Promise<void>;
  logout: () => void;
  switchAccountDemo: (targetEmail: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = async () => {
    try {
      const data = await ApiService.getMe();
      setUser(data.user);
    } catch (err) {
      localStorage.removeItem('vtx_token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Cross-subdomain session transfer: auto-consume token passed in query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const queryToken = urlParams.get('auth_token') || urlParams.get('token');
    if (queryToken) {
      localStorage.setItem('vtx_token', queryToken);
      const url = new URL(window.location.href);
      url.searchParams.delete('auth_token');
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
    }

    const token = localStorage.getItem('vtx_token');
    if (token) {
      fetchCurrentUser();
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password = 'password') => {
    setLoading(true);
    try {
      const resp = await ApiService.login(email, password);
      localStorage.setItem('vtx_token', resp.token);
      setUser(resp.user);
      return resp;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, password: string, fullName: string, companyName?: string, inviteToken?: string) => {
    setLoading(true);
    try {
      const resp = await ApiService.register(email, password, fullName, companyName, inviteToken);
      localStorage.setItem('vtx_token', resp.token);
      setUser(resp.user);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    localStorage.removeItem('vtx_token');
    localStorage.removeItem('vtx_user');
    await supabase.auth.signOut().catch(() => {});
    setUser(null);
  };

  const switchAccountDemo = async (targetEmail: string) => {
    await login(targetEmail);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, switchAccountDemo }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
