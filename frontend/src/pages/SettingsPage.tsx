import React from 'react';
import { Settings, Shield, User, Globe, Key } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Organization & Account Settings</h1>
        <p className="text-xs md:text-sm text-gray-400">
          Configure security, API keys, and multi-tenant credentials
        </p>
      </div>

      <div className="rounded-2xl bg-gray-900/70 border border-gray-800 p-6 space-y-6 shadow-xl">
        <div className="space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <User className="h-4 w-4 text-indigo-400" />
            <span>Profile Information</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="text-gray-400 block mb-1 font-semibold">Full Name</label>
              <input
                type="text"
                readOnly
                value={user?.fullName || ''}
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200"
              />
            </div>
            <div>
              <label className="text-gray-400 block mb-1 font-semibold">Email Address</label>
              <input
                type="email"
                readOnly
                value={user?.email || ''}
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200"
              />
            </div>
            <div>
              <label className="text-gray-400 block mb-1 font-semibold">Account Role</label>
              <input
                type="text"
                readOnly
                value={user?.role || ''}
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200 uppercase font-mono text-[11px]"
              />
            </div>
            <div>
              <label className="text-gray-400 block mb-1 font-semibold">Tenant Organization ID</label>
              <input
                type="text"
                readOnly
                value={user?.organizationId || ''}
                className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-400 font-mono text-[11px]"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-800 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-400" />
            <span>Security & Isolation Status</span>
          </h3>
          <div className="p-4 rounded-xl bg-gray-950 border border-gray-800 text-xs text-gray-400 space-y-2">
            <div className="flex items-center justify-between">
              <span>Row Level Security (RLS)</span>
              <span className="text-emerald-400 font-semibold">Enforced in Supabase</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Cloudflare Tunnel Zero-Trust</span>
              <span className="text-cyan-400 font-semibold">Active & Encrypted</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Device Sharing PIN Encryption</span>
              <span className="text-emerald-400 font-semibold">bcrypt (10 rounds)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
