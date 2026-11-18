import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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
