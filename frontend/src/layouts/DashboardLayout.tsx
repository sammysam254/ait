import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Smartphone,
  Server,
  DownloadCloud,
  Share2,
  Users,
  FileText,
  Settings,
  CreditCard,
  ShieldCheck,
  LayoutDashboard,
  LogOut,
  ChevronDown,
  Menu,
  X,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const DashboardLayout: React.FC = () => {
  const { user, logout, switchAccountDemo } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false);
  const navigate = useNavigate();

  const isCustomer = user?.role === 'customer';
  const isAdmin = user?.role === 'admin';
  const isAssignedUser = user?.role === 'assigned_user';

  const navItems = [
    { name: 'Overview', to: '/dashboard', icon: LayoutDashboard, visible: true },
    { name: 'Devices', to: '/devices', icon: Smartphone, visible: true },
    { name: 'Windows Agents', to: '/agents', icon: Server, visible: isCustomer || isAdmin },
    { name: 'Setup Script', to: '/setup-script', icon: DownloadCloud, visible: isCustomer || isAdmin },
    { name: 'Shared Access', to: '/shared-access', icon: Share2, visible: isCustomer || isAdmin },
    { name: 'Assigned Users', to: '/assigned-users', icon: Users, visible: isCustomer || isAdmin },
    { name: 'Activity Logs', to: '/activity-logs', icon: FileText, visible: true },
    { name: 'Subscription', to: '/subscription', icon: CreditCard, visible: isCustomer },
    { name: 'Settings', to: '/settings', icon: Settings, visible: true },
    { name: 'Admin Portal', to: '/admin', icon: ShieldCheck, visible: isAdmin },
  ].filter(i => i.visible);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col md:flex-row">
      {/* Sidebar for Desktop */}
      <aside className="hidden md:flex flex-col w-64 border-r border-gray-800/80 bg-gray-900/60 backdrop-blur-xl shrink-0 p-4 justify-between">
        <div className="space-y-6">
          {/* Brand Logo */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
              <Smartphone className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-400 bg-clip-text text-transparent">
                VERTEX
              </span>
              <span className="ml-1 text-xs font-semibold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                CLOUD
              </span>
            </div>
          </div>

          {/* Tenant Card */}
          <div className="px-3 py-2.5 rounded-xl bg-gray-800/40 border border-gray-800 text-xs space-y-1">
            <div className="text-gray-400 font-medium uppercase tracking-wider text-[10px]">
              Active Organization
            </div>
            <div className="font-semibold text-gray-200 truncate">
              {user?.organizationName || 'Cloud Device Farm'}
            </div>
            <div className="flex items-center gap-2 pt-1 text-[11px] text-gray-400">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Plan: {user?.plan || 'starter'}</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.name}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* User Card */}
        <div className="pt-4 border-t border-gray-800/80 space-y-2">
          {isAdmin && (
            <div className="px-2.5 py-1.5 rounded-lg bg-purple-950/40 border border-purple-500/30 text-xs text-purple-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="h-3.5 w-3.5 text-purple-400" />
                <span>Super Admin</span>
              </span>
              <span className="text-[10px] bg-purple-500/20 px-1.5 py-0.5 rounded text-purple-300">
                Active
              </span>
            </div>
          )}

          <div className="flex items-center justify-between px-2 py-1.5">
            <div className="truncate mr-2">
              <div className="text-xs font-semibold text-gray-200 truncate">{user?.fullName || user?.email}</div>
              <div className="text-[11px] text-gray-500 truncate">{user?.email}</div>
            </div>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/90 backdrop-blur sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <Smartphone className="h-6 w-6 text-indigo-400" />
          <span className="font-bold text-lg tracking-tight">VERTEX CLOUD</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-lg bg-gray-800 text-gray-300"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-gray-800 bg-gray-900 p-4 space-y-3 z-50">
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.name}</span>
                </NavLink>
              );
            })}
          </nav>
          <div className="pt-2 border-t border-gray-800 flex justify-between items-center text-xs">
            <span className="text-gray-400">{user?.email}</span>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="text-red-400 hover:underline"
            >
              Logout
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
        <Outlet />
      </main>
    </div>
  );
};
