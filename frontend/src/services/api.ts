import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.vertext.online/api';

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

    if (typeof window !== 'undefined' && window.location?.hostname) {
      headers['X-Vertex-Domain'] = window.location.hostname;
    }

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
  static async login(email: string, password = ''): Promise<{
    token: string;
    user: any;
    requiresSubdomainRedirect?: boolean;
    redirectUrl?: string;
    subdomain?: string;
    requiresSubdomainSetup?: boolean;
  }> {
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
      const token = supaData.session.access_token;
      localStorage.setItem('vtx_token', token);

      let userObj: any = {
        id: supaData.session.user.id,
        email: cleanEmail,
        fullName: isSuperAdmin ? 'Sammy Seth (Super Admin)' : (userMeta.full_name || cleanEmail.split('@')[0]),
        role: isSuperAdmin ? 'admin' : 'customer',
        organizationId: isSuperAdmin ? 'aaaa0000-0000-0000-0000-000000000001' : supaData.session.user.id,
        organizationName: isSuperAdmin ? 'Vertex Global Device Farm' : `${cleanEmail.split('@')[0]}'s Cloud Devices`,
        plan: isSuperAdmin ? 'enterprise' : 'starter',
        subdomain: undefined,
      };

      try {
        const meRes = await this.request<{ user: any }>('/auth/me');
        if (meRes?.user) {
          userObj = { ...userObj, ...meRes.user };
        }
      } catch (e: any) {
        if (
          e.message &&
          (e.message.includes('Access Denied') ||
            e.message.includes('denied') ||
            e.message.includes('Cross-tenant') ||
            e.message.includes('Invalid') ||
            e.message.includes('expired') ||
            e.message.includes('Authentication required'))
        ) {
          localStorage.removeItem('vtx_token');
          localStorage.removeItem('vtx_user');
          await supabase.auth.signOut().catch(() => {});
          throw e;
        }
      }

      localStorage.setItem('vtx_user', JSON.stringify(userObj));

      const isRootHost = (
        window.location.hostname === 'vertext.online' ||
        window.location.hostname === 'www.vertext.online' ||
        window.location.hostname === 'vertextstreams.netlify.app'
      );

      const requiresSubdomainRedirect = isRootHost && !isSuperAdmin && !!userObj.subdomain;
      const requiresSubdomainSetup = isRootHost && !isSuperAdmin && !userObj.subdomain;

      return {
        token,
        user: userObj,
        requiresSubdomainRedirect,
        redirectUrl: userObj.subdomain ? `https://${userObj.subdomain}` : undefined,
        subdomain: userObj.subdomain || undefined,
        requiresSubdomainSetup,
      };
    }

    throw new Error('Login failed. Please check your credentials.');
  }

  static async register(email: string, password: string, fullName: string, companyName?: string, inviteToken?: string): Promise<{ token: string; user: any }> {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail || !password) {
      throw new Error('Please enter both email and password.');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    const isSuperAdmin = cleanEmail === 'sammyseth260@gmail.com';
    const role = isSuperAdmin ? 'admin' : (inviteToken ? 'assigned_user' : 'customer');

    // 1. If registering as an invited worker, notify backend directly with inviteToken
    if (inviteToken) {
      try {
        const backendRes = await this.request<{ token: string; user: any }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: cleanEmail,
            password,
            fullName,
            inviteToken,
          }),
        });

        // Also register with Supabase Auth in background for credential syncing
        supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: fullName,
              system_role: 'assigned_user',
              inviteToken,
            },
          },
        }).catch(() => {});

        localStorage.setItem('vtx_token', backendRes.token);
        localStorage.setItem('vtx_user', JSON.stringify(backendRes.user));
        return backendRes;
      } catch (beErr: any) {
        // Fallback to Supabase if backend had non-blocking error
        console.warn('Backend invite register returned:', beErr);
      }
    }

    // 2. Standard registration with Supabase Auth
    const { data: supaData, error: supaErr } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          full_name: fullName,
          system_role: role,
          inviteToken: inviteToken || undefined,
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
      // Sync with backend API
      try {
        const backendRes = await this.request<{ token: string; user: any }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: cleanEmail,
            password,
            fullName,
            companyName,
            inviteToken,
          }),
        });
        localStorage.setItem('vtx_token', backendRes.token);
        localStorage.setItem('vtx_user', JSON.stringify(backendRes.user));
        return backendRes;
      } catch (err) {
        console.warn('Backend sync warning:', err);
      }

      // If auto-logged in with session
      if (supaData.session) {
        let userObj = {
          id: supaData.session.user.id,
          email: cleanEmail,
          fullName: isSuperAdmin ? 'Sammy Seth (Super Admin)' : (fullName || cleanEmail.split('@')[0]),
          role: role,
          organizationId: supaData.session.user.id,
          organizationName: companyName || `${cleanEmail.split('@')[0]}'s Cloud Devices`,
          plan: isSuperAdmin ? 'enterprise' : 'starter',
        };
        const token = supaData.session.access_token;
        localStorage.setItem('vtx_token', token);

        try {
          const meRes = await this.request<{ user: any }>('/auth/me');
          if (meRes?.user) {
            userObj = { ...userObj, ...meRes.user };
          }
        } catch (e) {}

        localStorage.setItem('vtx_user', JSON.stringify(userObj));
        return { token, user: userObj };
      }

      // If session is null (e.g. Supabase auto-confirmed or requires sign-in)
      try {
        const loginAttempt = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (loginAttempt.data?.session) {
          let userObj = {
            id: loginAttempt.data.session.user.id,
            email: cleanEmail,
            fullName: isSuperAdmin ? 'Sammy Seth (Super Admin)' : (fullName || cleanEmail.split('@')[0]),
            role: role,
            organizationId: loginAttempt.data.session.user.id,
            organizationName: companyName || `${cleanEmail.split('@')[0]}'s Cloud Devices`,
            plan: isSuperAdmin ? 'enterprise' : 'starter',
          };
          const token = loginAttempt.data.session.access_token;
          localStorage.setItem('vtx_token', token);

          try {
            const meRes = await this.request<{ user: any }>('/auth/me');
            if (meRes?.user) {
              userObj = { ...userObj, ...meRes.user };
            }
          } catch (e) {}

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
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      const cleanEmail = data.session.user.email?.toLowerCase().trim() || '';
      const isSuperAdmin = cleanEmail === 'sammyseth260@gmail.com';
      const userMeta = data.session.user.user_metadata || {};
      let userObj = {
        id: data.session.user.id,
        email: cleanEmail,
        fullName: isSuperAdmin ? 'Sammy Seth (Super Admin)' : (userMeta.full_name || cleanEmail.split('@')[0]),
        role: isSuperAdmin ? 'admin' : 'customer',
        organizationId: isSuperAdmin ? 'aaaa0000-0000-0000-0000-000000000001' : data.session.user.id,
        organizationName: isSuperAdmin ? 'Vertex Global Device Farm' : `${cleanEmail.split('@')[0]}'s Cloud Devices`,
        plan: isSuperAdmin ? 'enterprise' : 'starter',
      };

      try {
        const meRes = await this.request<{ user: any }>('/auth/me');
        if (meRes?.user) {
          userObj = { ...userObj, ...meRes.user };
        }
      } catch (e: any) {
        if (
          e.message &&
          (e.message.includes('Access Denied') ||
            e.message.includes('denied') ||
            e.message.includes('Cross-tenant') ||
            e.message.includes('Invalid') ||
            e.message.includes('expired') ||
            e.message.includes('Authentication required'))
        ) {
          localStorage.removeItem('vtx_token');
          localStorage.removeItem('vtx_user');
          await supabase.auth.signOut().catch(() => {});
          throw e;
        }
      }

      localStorage.setItem('vtx_user', JSON.stringify(userObj));
      return { user: userObj };
    }

    localStorage.removeItem('vtx_token');
    localStorage.removeItem('vtx_user');
    throw new Error('Not authenticated');
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
    return this.request<{ device: any; permissions: any; agent: any; streamToken?: string; streamWsUrl?: string }>(`/devices/${id}`);
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
    return `${API_BASE}/enrollment/download-script?token=${encodeURIComponent(token || '')}`;
  }

  static async downloadSetupScript(): Promise<void> {
    const token = this.getToken();
    const downloadUrl = this.getDownloadScriptUrl();
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Download failed (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'setup.bat';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
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

  static async getInviteInfo(token: string) {
    return this.request<{ valid: boolean; email?: string; fullName?: string; orgName?: string; error?: string }>(
      `/assignments/invite-info?token=${encodeURIComponent(token)}`
    );
  }

  static async inviteUser(email: string, fullName?: string) {
    return this.request<{ success: boolean; user: any; inviteUrl: string; token: string; message: string }>('/assignments/invite', {
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

  static async revokeUser(assignedUserId: string) {
    return this.request<{ success: boolean; message: string }>('/assignments/revoke-user', {
      method: 'POST',
      body: JSON.stringify({ assignedUserId }),
    });
  }

  static async getDeviceCredentials(deviceId: string) {
    return this.request<{ url: string; pin: string }>(`/assignments/device-credentials/${deviceId}`);
  }

  // Subscription & Paystack Payment
  static async getSubscriptionStatus() {
    return this.request<{
      organizationId: string;
      organizationName: string;
      plan: 'starter' | 'enterprise' | 'custom';
      planDetails: any;
      status: 'active' | 'trial_active' | 'expired' | 'past_due' | 'terms_required';
      active: boolean;
      reason?: string;
      dueDate?: string;
      daysRemaining: number;
      termsAccepted: boolean;
      termsAcceptedAt?: string;
      maxDevices: number;
      maxAgents: number;
      lastPaymentReference?: string;
      lastPaymentAmount?: number;
      customPriceUsd?: number;
      contactPhone: string;
      terms: Array<{ id: number; title: string; content: string }>;
      plans: Record<string, any>;
      paystackPublicKey: string;
    }>('/subscription/status');
  }

  static async acceptSubscriptionTerms() {
    return this.request<{ success: boolean; message: string; status: any }>('/subscription/accept-terms', {
      method: 'POST',
    });
  }

  static async startStarterTrial() {
    return this.request<{ success: boolean; message: string; status: any }>('/subscription/start-trial', {
      method: 'POST',
    });
  }

  static async initializePaystack(plan: 'starter' | 'enterprise') {
    return this.request<{
      reference: string;
      amountCents: number;
      amountUsd: number;
      amountKes?: number;
      currency?: string;
      publicKey: string;
      email: string;
      plan: string;
    }>('/subscription/initialize-paystack', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
  }

  static async verifyPaystackPayment(reference: string, plan: 'starter' | 'enterprise') {
    return this.request<{ success: boolean; message: string; status: any }>('/subscription/verify-paystack', {
      method: 'POST',
      body: JSON.stringify({ reference, plan }),
    });
  }

  static async adminSetSubscription(data: {
    organizationId: string;
    plan?: 'starter' | 'enterprise' | 'custom';
    subscriptionStatus?: 'active' | 'trial_active' | 'expired';
    maxDevices?: number;
    maxAgents?: number;
    priceUsd?: number;
    durationDays?: number;
    customPricing?: { starter?: number; enterprise?: number; custom?: number };
    priceAdjustmentUsd?: number;
    pricingNote?: string;
  }) {
    return this.request<{ success: boolean; organization: any; message: string }>('/admin/set-subscription', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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

  // =========================================================================
  // CUSTOM DOMAIN & MULTI-TENANT BRANDING API
  // =========================================================================

  static async getDomains(): Promise<{ domains: any[] }> {
    return await this.request<{ domains: any[] }>('/domains');
  }

  static async searchCloudflareZones(query = '', customToken?: string): Promise<{ zones: any[] }> {
    const params = new URLSearchParams({ query });
    if (customToken) params.set('token', customToken);
    return await this.request<{ zones: any[] }>(`/domains/search-cloudflare?${params.toString()}`);
  }

  static async connectCloudflareDomain(domain: string, cfZoneId?: string, customToken?: string): Promise<any> {
    return await this.request<any>('/domains/connect-cloudflare', {
      method: 'POST',
      body: JSON.stringify({ domain, cfZoneId, customToken }),
    });
  }

  static async checkDomainAvailability(domain: string): Promise<{ available: boolean; price?: number; redirectUrl?: string }> {
    return await this.request<any>(`/domains/check-availability?domain=${encodeURIComponent(domain)}`);
  }

  static async provisionSubdomain(subdomain: string): Promise<any> {
    return await this.request<any>('/domains/provision-subdomain', {
      method: 'POST',
      body: JSON.stringify({ subdomain }),
    });
  }

  static async updateSubdomain(domainId: string, subdomain: string): Promise<any> {
    return await this.request<any>(`/domains/${domainId}/subdomain`, {
      method: 'PUT',
      body: JSON.stringify({ subdomain }),
    });
  }

  static async buyDomain(domain: string, years = 1): Promise<any> {
    return await this.request<any>('/domains/buy-domain', {
      method: 'POST',
      body: JSON.stringify({ domain, years }),
    });
  }

  /** Called after returning from or during Cloudflare Registrar — polls for new zone and auto-activates */
  static async pollPurchase(domain: string, stateToken?: string, customToken?: string): Promise<any> {
    return await this.request<any>('/domains/poll-purchase', {
      method: 'POST',
      body: JSON.stringify({ stateToken, domain, customToken }),
    });
  }

  static async transferCloudflareDomain(domain: string, customToken?: string): Promise<any> {
    return await this.request<any>('/domains/transfer-cloudflare', {
      method: 'POST',
      body: JSON.stringify({ domain, customToken }),
    });
  }

  static async checkTransferStatus(domainId: string, customToken?: string): Promise<any> {
    return await this.request<any>(`/domains/${domainId}/check-transfer`, {
      method: 'POST',
      body: JSON.stringify({ customToken }),
    });
  }

  static async addExternalDomain(domain: string): Promise<any> {
    return await this.request<any>('/domains/external', {
      method: 'POST',
      body: JSON.stringify({ domain }),
    });
  }

  static async verifyExternalDomain(domainId: string): Promise<any> {
    return await this.request<any>(`/domains/${domainId}/verify`, {
      method: 'POST',
    });
  }

  static async removeDomain(domainId: string): Promise<any> {
    return await this.request<any>(`/domains/${domainId}`, {
      method: 'DELETE',
    });
  }

  static async resolveDomainTenant(host?: string): Promise<{ matched: boolean; isDefaultHost?: boolean; domain?: string; organization: any | null }> {
    const targetHost = host || (typeof window !== 'undefined' ? window.location.hostname : '');
    return await this.request<any>(`/domains/resolve?host=${encodeURIComponent(targetHost)}`);
  }
}
