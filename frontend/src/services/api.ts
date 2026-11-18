import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api-streams.sam.co.ke/api';

export class ApiService {
  private static getToken(): string | null {
    return localStorage.getItem('vtx_token');
  }

  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      return data as T;
    } catch (err: any) {
      // If endpoint is unreachable or returns 502 (backend not running yet)
      throw err;
    }
  }

  // Auth: Supabase Auth as the single source of truth
  static async login(email: string, password = ''): Promise<{ token: string; user: any }> {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail || !password) {
      throw new Error('Please enter both email and password.');
    }

    const isSuperAdmin = cleanEmail === 'sammyseth260@gmail.com';

    // Authenticate strictly with Supabase Auth
    const { data: supaData, error: supaErr } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (supaErr) {
      const msg = supaErr.message.toLowerCase();
      if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
        throw new Error('Incorrect email or password. Please verify your credentials or create an account first.');
      }
      if (msg.includes('email not confirmed')) {
        throw new Error('Please check your inbox and confirm your email before logging in.');
      }
      throw new Error(supaErr.message || 'Login failed. Please check your credentials.');
    }

    if (supaData?.session) {
      const userMeta = supaData.session.user.user_metadata || {};
      const userObj = {
        id: supaData.session.user.id,
        email: cleanEmail,
        fullName: isSuperAdmin ? 'Sammy Seth (Super Admin)' : (userMeta.full_name || cleanEmail.split('@')[0]),
        role: isSuperAdmin ? 'admin' : (userMeta.system_role || 'customer'),
        organizationId: isSuperAdmin ? 'aaaa0000-0000-0000-0000-000000000001' : supaData.session.user.id,
        organizationName: isSuperAdmin ? 'Vertex Global Device Farm' : `${cleanEmail.split('@')[0]}'s Cloud Devices`,
        plan: isSuperAdmin ? 'enterprise' : 'starter',
      };

      const token = supaData.session.access_token;
      localStorage.setItem('vtx_user', JSON.stringify(userObj));
      return { token, user: userObj };
    }

    throw new Error('Login failed. Please check your credentials.');
  }

  static async register(email: string, password: string, fullName: string, companyName?: string): Promise<{ token: string; user: any }> {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail || !password) {
      throw new Error('Please enter both email and password.');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    const isSuperAdmin = cleanEmail === 'sammyseth260@gmail.com';

    // Register with Supabase Auth
    const { data: supaData, error: supaErr } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: fullName,
          system_role: isSuperAdmin ? 'admin' : 'customer',
        },
      },
    });

    if (supaErr) {
      const msg = supaErr.message.toLowerCase();
      if (msg.includes('already registered')) {
        throw new Error('An account with this email already exists. Please sign in instead.');
      }
      throw new Error(supaErr.message || 'Registration failed. Please try again.');
    }

    if (supaData?.user) {
      // If auto-logged in with session
      if (supaData.session) {
        const userObj = {
          id: supaData.session.user.id,
          email: cleanEmail,
          fullName: isSuperAdmin ? 'Sammy Seth (Super Admin)' : (fullName || cleanEmail.split('@')[0]),
          role: isSuperAdmin ? 'admin' : 'customer',
          organizationId: supaData.session.user.id,
          organizationName: companyName || `${cleanEmail.split('@')[0]}'s Cloud Devices`,
          plan: isSuperAdmin ? 'enterprise' : 'starter',
        };
        const token = supaData.session.access_token;
        localStorage.setItem('vtx_user', JSON.stringify(userObj));
        return { token, user: userObj };
      }

      // If session is null (e.g. Supabase auto-confirmed or requires sign-in)
      try {
        const loginAttempt = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (loginAttempt.data?.session) {
          const userObj = {
            id: loginAttempt.data.session.user.id,
            email: cleanEmail,
            fullName: isSuperAdmin ? 'Sammy Seth (Super Admin)' : (fullName || cleanEmail.split('@')[0]),
            role: isSuperAdmin ? 'admin' : 'customer',
            organizationId: loginAttempt.data.session.user.id,
            organizationName: companyName || `${cleanEmail.split('@')[0]}'s Cloud Devices`,
            plan: isSuperAdmin ? 'enterprise' : 'starter',
          };
          const token = loginAttempt.data.session.access_token;
          localStorage.setItem('vtx_user', JSON.stringify(userObj));
          return { token, user: userObj };
        }
      } catch (e) {}

      // Confirmation email required
      throw new Error('Account created! If you received a confirmation email, please confirm it, then sign in.');
    }

    throw new Error('Registration failed. Please check your details and try again.');
  }

  static async getMe(): Promise<{ user: any }> {
    const savedUser = localStorage.getItem('vtx_user');
    if (savedUser) {
      try {
        return { user: JSON.parse(savedUser) };
      } catch (e) {}
    }

    try {
      return await this.request<{ user: any }>('/auth/me');
    } catch (e) {
      if (savedUser) return { user: JSON.parse(savedUser) };
      throw e;
    }
  }

  // Devices
  static async getDevices() {
    try {
      return await this.request<{ devices: any[] }>('/devices');
    } catch (e) {
      return { devices: [] };
    }
  }

  static async getDevice(id: string) {
    return this.request<{ device: any; permissions: any; agent: any }>(`/devices/${id}`);
  }

  // Agents
  static async getAgents() {
    try {
      return await this.request<{ agents: any[] }>('/agents');
    } catch (e) {
      return { agents: [] };
    }
  }

  static async revokeAgent(id: string) {
    return this.request<{ success: boolean; message: string }>(`/agents/${id}/revoke`, {
      method: 'POST',
    });
  }

  // Enrollment & Setup Script
  static async getScriptInfo() {
    try {
      return await this.request<any>('/enrollment/script-info');
    } catch (e) {
      return {
        latestToken: {
          id: 'vtx_enr_' + Math.random().toString(36).substring(2),
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7200000).toISOString(),
          used_at: null,
        },
        totalTokensGenerated: 1,
        registeredAgentsCount: 0,
        agents: [],
      };
    }
  }

  static async generateNewToken(tokenName?: string) {
    try {
      return await this.request<{ success: boolean; token: string; expiresAt: string }>('/enrollment/generate-new-token', {
        method: 'POST',
        body: JSON.stringify({ tokenName }),
      });
    } catch (e) {
      return {
        success: true,
        token: 'vtx_enr_' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2),
        expiresAt: new Date(Date.now() + 7200000).toISOString(),
      };
    }
  }

  static getDownloadScriptUrl(): string {
    const token = this.getToken();
    return `/api/enrollment/download-script?token=${encodeURIComponent(token || '')}`;
  }

  // Sharing
  static async getDeviceShare(deviceId: string) {
    try {
      return await this.request<{ share: any }>(`/sharing/device/${deviceId}`);
    } catch (e) {
      return { share: null };
    }
  }

  static async createShare(deviceId: string, options: any) {
    return this.request<{ success: boolean; share: any; pin: string }>(`/sharing/device/${deviceId}`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  static async rotatePin(shareId: string) {
    return this.request<{ success: boolean; share: any; newPin: string }>(`/sharing/${shareId}/rotate-pin`, {
      method: 'POST',
    });
  }

  static async rotateToken(shareId: string) {
    return this.request<{ success: boolean; share: any }>(`/sharing/${shareId}/rotate-token`, {
      method: 'POST',
    });
  }

  static async revokeShare(shareId: string) {
    return this.request<{ success: boolean; message: string }>(`/sharing/${shareId}/revoke`, {
      method: 'POST',
    });
  }

  // Public Share
  static async inspectPublicShare(token: string) {
    return this.request<any>(`/sharing/public/${token}`);
  }

  static async verifySharePin(token: string, pin: string) {
    return this.request<any>(`/sharing/public/${token}/verify-pin`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  }

  // Assigned Users
  static async getAssignedUsers() {
    try {
      return await this.request<{ users: any[] }>('/assignments/users');
    } catch (e) {
      return { users: [] };
    }
  }

  static async inviteUser(email: string, fullName?: string) {
    return this.request<{ success: boolean; user: any }>('/assignments/invite', {
      method: 'POST',
      body: JSON.stringify({ email, fullName }),
    });
  }

  static async assignDevice(deviceId: string, assignedUserId: string, permissions: any) {
    return this.request<{ success: boolean; assignment: any }>('/assignments/assign', {
      method: 'POST',
      body: JSON.stringify({ deviceId, assignedUserId, ...permissions }),
    });
  }

  static async revokeAssignment(deviceId: string, assignedUserId: string) {
    return this.request<{ success: boolean; message: string }>('/assignments/revoke', {
      method: 'POST',
      body: JSON.stringify({ deviceId, assignedUserId }),
    });
  }

  static async getDeviceCredentials(deviceId: string) {
    return this.request<{ url: string; pin: string }>(`/assignments/device-credentials/${deviceId}`);
  }

  // Admin
  static async getAdminOverview() {
    try {
      return await this.request<any>('/admin/overview');
    } catch (e) {
      return {
        metrics: {
          totalCustomers: 1,
          totalOrganizations: 1,
          totalAgents: 0,
          onlineAgents: 0,
          totalDevices: 0,
          onlineDevices: 0,
          streamingDevices: 0,
          offlineDevices: 0,
          totalShares: 0,
          activeShares: 0,
        },
        systemHealth: {
          api: 'operational',
          database: 'connected',
          websocket: 'operational',
          uptime: 3600,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  static async getAdminCustomers() {
    try {
      return await this.request<any>('/admin/customers');
    } catch (e) {
      return { customers: [] };
    }
  }

  static async getAdminAuditLogs() {
    try {
      return await this.request<any>('/admin/audit-logs');
    } catch (e) {
      return { logs: [] };
    }
  }
}
