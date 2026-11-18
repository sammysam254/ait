import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Server,
  Smartphone,
  Users,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Building,
} from 'lucide-react';
import { ApiService } from '../services/api';

export const AdminPortalPage: React.FC = () => {
  const [overview, setOverview] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAdminData();
  }, []);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [oRes, cRes] = await Promise.all([
        ApiService.getAdminOverview(),
        ApiService.getAdminCustomers(),
      ]);
      setOverview(oRes);
      setCustomers(cRes.customers || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const metrics = overview?.metrics;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-semibold mb-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Super Admin Clearance</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Platform Global Administration</h1>
          <p className="text-xs md:text-sm text-gray-400">
            System health, multi-tenant organizations, agent fleet telemetry, and cross-customer quotas
          </p>
        </div>

        <button
          onClick={loadAdminData}
          className="p-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Admin Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-1">
          <div className="text-xs text-gray-400 uppercase font-semibold">Total Organizations</div>
          <div className="text-2xl font-bold text-white">{metrics?.totalOrganizations ?? 0}</div>
          <div className="text-[11px] text-gray-500">{metrics?.totalCustomers ?? 0} customer owners</div>
        </div>

        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-1">
          <div className="text-xs text-gray-400 uppercase font-semibold">Total Devices</div>
          <div className="text-2xl font-bold text-white">{metrics?.totalDevices ?? 0}</div>
          <div className="text-[11px] text-emerald-400">{metrics?.onlineDevices ?? 0} online across all tenants</div>
        </div>

        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-1">
          <div className="text-xs text-gray-400 uppercase font-semibold">Active Windows Hosts</div>
          <div className="text-2xl font-bold text-white">{metrics?.onlineAgents ?? 0} / {metrics?.totalAgents ?? 0}</div>
          <div className="text-[11px] text-cyan-400">Global scrcpy agents</div>
        </div>

        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-1">
          <div className="text-xs text-gray-400 uppercase font-semibold">System Health</div>
          <div className="text-2xl font-bold text-emerald-400">100%</div>
          <div className="text-[11px] text-gray-400">WebRTC, API, DB Operational</div>
        </div>
      </div>

      {/* Customers Table */}
      <div className="rounded-2xl bg-gray-900/70 border border-gray-800 overflow-hidden shadow-xl space-y-4">
        <div className="p-5 pb-0 flex items-center justify-between">
          <h3 className="font-bold text-base text-white flex items-center gap-2">
            <Building className="h-5 w-5 text-indigo-400" />
            <span>Registered Customer Accounts</span>
          </h3>
          <span className="text-xs text-gray-500 font-medium">{customers.length} tenant(s)</span>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-gray-950/70 text-gray-400 uppercase tracking-wider text-[10px] border-y border-gray-800">
            <tr>
              <th className="p-4">Customer Organization</th>
              <th className="p-4">Owner Email</th>
              <th className="p-4">Plan & Quota</th>
              <th className="p-4">Phones</th>
              <th className="p-4">Windows Hosts</th>
              <th className="p-4">Subordinate Users</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 text-gray-300">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-800/40 transition">
                <td className="p-4 font-bold text-gray-100">
                  {c.name}
                </td>
                <td className="p-4 text-gray-300 font-mono text-[11px]">
                  {c.ownerEmail}
                </td>
                <td className="p-4">
                  <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                    {c.plan} ({c.maxDevices} max)
                  </span>
                </td>
                <td className="p-4 font-semibold text-emerald-400">
                  {c.deviceCount} connected
                </td>
                <td className="p-4 text-gray-300">
                  {c.agentCount} host(s)
                </td>
                <td className="p-4 text-gray-400">
                  {c.assignedUsersCount} user(s)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
