const API_BASE = '/api';

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

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `HTTP error ${res.status}`);
    }

    return data as T;
  }

  // Auth
  static async login(email: string, password = 'password') {
    return this.request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  static async register(email: string, fullName: string, companyName?: string) {
    return this.request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, fullName, companyName }),
    });
  }

  static async getMe() {
    return this.request<{ user: any }>('/auth/me');
  }

  // Devices
  static async getDevices() {
    return this.request<{ devices: any[] }>('/devices');
  }

  static async getDevice(id: string) {
    return this.request<{ device: any; permissions: any; agent: any }>(`/devices/${id}`);
  }

  // Agents
  static async getAgents() {
    return this.request<{ agents: any[] }>('/agents');
  }

  static async revokeAgent(id: string) {
    return this.request<{ success: boolean; message: string }>(`/agents/${id}/revoke`, {
      method: 'POST',
    });
  }

  // Enrollment & Setup Script
  static async getScriptInfo() {
    return this.request<any>('/enrollment/script-info');
  }

  static async generateNewToken(tokenName?: string) {
    return this.request<{ success: boolean; token: string; expiresAt: string }>('/enrollment/generate-new-token', {
      method: 'POST',
      body: JSON.stringify({ tokenName }),
    });
  }

  static getDownloadScriptUrl(): string {
    const token = this.getToken();
    return `/api/enrollment/download-script?token=${encodeURIComponent(token || '')}`;
  }

  // Sharing
  static async getDeviceShare(deviceId: string) {
    return this.request<{ share: any }>(`/sharing/device/${deviceId}`);
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
    return this.request<{ users: any[] }>('/assignments/users');
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
    return this.request<any>('/admin/overview');
  }

  static async getAdminCustomers() {
    return this.request<any>('/admin/customers');
  }

  static async getAdminAuditLogs() {
    return this.request<any>('/admin/audit-logs');
  }
}
