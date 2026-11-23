import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Globe, Loader2, ArrowRight } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ApiService } from './services/api';
import { DashboardLayout } from './layouts/DashboardLayout';

// Pages
import { DashboardOverview } from './pages/DashboardOverview';
import { DevicesPage } from './pages/DevicesPage';
import { DeviceViewerPage } from './pages/DeviceViewerPage';
import { WindowsAgentsPage } from './pages/WindowsAgentsPage';
import { SetupScriptPage } from './pages/SetupScriptPage';
import { SharedAccessPage } from './pages/SharedAccessPage';
import { AssignedUsersPage } from './pages/AssignedUsersPage';
import { ActivityLogsPage } from './pages/ActivityLogsPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPortalPage } from './pages/AdminPortalPage';
import { PublicShareViewPage } from './pages/PublicShareViewPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const [subdomainInput, setSubdomainInput] = useState('');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-indigo-400">
        Loading Vertex Cloud...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isSuperAdmin = user.role === 'admin' || user.email?.toLowerCase() === 'sammyseth260@gmail.com';
  const isRootHost = (
    window.location.hostname === 'vertext.online' ||
    window.location.hostname === 'www.vertext.online' ||
    window.location.hostname === 'vertextstreams.netlify.app'
  );

  // If a customer accesses vertext.online, enforce mandatory subdomain gateway access
  if (isRootHost && !isSuperAdmin) {
    const userSubdomain = (user as any).subdomain;
    if (userSubdomain) {
      window.location.href = `https://${userSubdomain}${window.location.pathname}?auth_token=${encodeURIComponent(localStorage.getItem('vtx_token') || '')}`;
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center text-xs text-indigo-400">
          Transferring session to {userSubdomain}...
        </div>
      );
    }

    const handleProvisionMandatorySubdomain = async (e: React.FormEvent) => {
      e.preventDefault();
      const cleanSlug = subdomainInput.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
      if (!cleanSlug || cleanSlug.length < 2) {
        setProvisionError('Subdomain must be at least 2 alphanumeric characters.');
        return;
      }
      setProvisioning(true);
      setProvisionError(null);
      try {
        await ApiService.provisionSubdomain(cleanSlug);
        window.location.href = `https://${cleanSlug}.vertext.online/dashboard?auth_token=${encodeURIComponent(localStorage.getItem('vtx_token') || '')}`;
      } catch (err: any) {
        setProvisionError(err.message || 'Failed to provision subdomain. Please choose another prefix.');
        setProvisioning(false);
      }
    };

    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-3xl bg-gray-900 border border-indigo-500/40 p-7 shadow-2xl space-y-5 text-center">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
            <Globe className="h-7 w-7" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-xl font-extrabold text-white">Setup Mandatory Subdomain</h3>
            <p className="text-xs text-gray-400">
              The root domain <span className="font-mono text-gray-200 font-bold">vertext.online</span> is strictly reserved for Super Admin. Every organization must activate their dedicated subdomain portal.
            </p>
          </div>
          {provisionError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs text-left">
              {provisionError}
            </div>
          )}
          <form onSubmit={handleProvisionMandatorySubdomain} className="space-y-4 text-left">
            <div className="flex items-center rounded-xl bg-gray-950 border border-gray-800 focus-within:border-indigo-500 overflow-hidden">
              <input
                type="text"
                required
                autoFocus
                placeholder="mybrand"
                value={subdomainInput}
                onChange={(e) => setSubdomainInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                className="w-full px-3 py-2.5 bg-transparent text-gray-100 placeholder-gray-600 text-xs focus:outline-none"
              />
              <span className="px-3 py-2.5 bg-gray-900/60 border-l border-gray-800 text-gray-400 font-mono text-xs select-none">
                .vertext.online
              </span>
            </div>
            <button
              type="submit"
              disabled={provisioning || !subdomainInput.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {provisioning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Provisioning Cloudflare DNS & SSL...</span>
                </>
              ) : (
                <>
                  <span>Activate & Enter Dashboard</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public Sharing URL */}
          <Route path="/share/:token" element={<PublicShareViewPage />} />

          {/* Authentication */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Authenticated Dashboard */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardOverview />} />
            <Route path="devices" element={<DevicesPage />} />
            <Route path="viewer/:id" element={<DeviceViewerPage />} />
            <Route path="agents" element={<WindowsAgentsPage />} />
            <Route path="setup-script" element={<SetupScriptPage />} />
            <Route path="shared-access" element={<SharedAccessPage />} />
            <Route path="assigned-users" element={<AssignedUsersPage />} />
            <Route path="activity-logs" element={<ActivityLogsPage />} />
            <Route path="subscription" element={<SubscriptionPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin" element={<AdminPortalPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
