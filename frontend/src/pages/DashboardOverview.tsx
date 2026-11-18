import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Smartphone,
  Server,
  Share2,
  Users,
  Radio,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Shield,
  Activity,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Device, Agent } from '../types';

export const DashboardOverview: React.FC = () => {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(false);
    try {
      const devRes = await ApiService.getDevices();
      setDevices(devRes.devices || []);
      
      if (user?.role === 'customer' || user?.role === 'admin') {
        const agtRes = await ApiService.getAgents();
        setAgents(agtRes.agents || []);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  const totalDevices = devices.length;
  const onlineDevices = devices.filter(d => d.status === 'online' || d.status === 'streaming').length;
  const offlineDevices = devices.filter(d => d.status === 'offline').length;
  const streamingDevices = devices.filter(d => d.status === 'streaming').length;
  const onlineAgents = agents.filter(a => a.status === 'online').length;

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-900/60 via-purple-900/40 to-gray-900 border border-indigo-500/20 p-6 md:p-8">
        <div className="relative z-10 max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
            <Radio className="h-3.5 w-3.5 animate-pulse text-emerald-400" />
            <span>scrcpy 3.3.4 Cloud Control Gateway Active</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Welcome back, {user?.fullName || user?.email}
          </h1>
          <p className="text-sm md:text-base text-gray-300">
            Remotely manage, view, share, and assign your Android phone fleet with low-latency H.264 streaming.
          </p>
          {(user?.role === 'customer' || user?.role === 'admin') && (
            <div className="pt-2 flex flex-wrap gap-3">
              <a
                href={ApiService.getDownloadScriptUrl()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/30 transition transform active:scale-95"
              >
                <DownloadCloud className="h-4 w-4" />
                <span>Download Setup Script (.bat)</span>
              </a>
              <Link
                to="/devices"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800/80 hover:bg-gray-800 text-gray-200 border border-gray-700 font-medium text-sm transition"
              >
                <span>View Device Fleet</span>
                <ArrowUpRight className="h-4 w-4 text-gray-400" />
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Devices */}
        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800/80 space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-medium uppercase tracking-wider">Total Devices</span>
            <Smartphone className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">{totalDevices}</div>
          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            <span className="text-emerald-400 font-medium">{onlineDevices} online</span>
            <span>•</span>
            <span className="text-gray-500">{offlineDevices} offline</span>
          </div>
        </div>

        {/* Active Streams */}
        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800/80 space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-medium uppercase tracking-wider">Active Streams</span>
            <Radio className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">{streamingDevices}</div>
          <div className="text-xs text-gray-400">
            H.264 low-latency WebRTC sessions
          </div>
        </div>

        {/* Windows Agents */}
        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800/80 space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-medium uppercase tracking-wider">Windows Hosts</span>
            <Server className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white">{agents.length}</div>
          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            <span className="text-emerald-400 font-medium">{onlineAgents} connected</span>
          </div>
        </div>

        {/* Organization Plan & Isolation */}
        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800/80 space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-xs font-medium uppercase tracking-wider">Tenant Isolation</span>
            <Shield className="h-4 w-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-white">Active</div>
          <div className="text-xs text-emerald-400 font-medium flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            <span>Multi-Tenant RLS Enforced</span>
          </div>
        </div>
      </div>

      {/* Connected Devices Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-indigo-400" />
            <span>Connected Devices ({devices.length})</span>
          </h2>
          <Link to="/devices" className="text-xs font-semibold text-indigo-400 hover:text-indigo-300">
            View All Devices &rarr;
          </Link>
        </div>

        {devices.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-800 p-8 text-center space-y-3">
            <Smartphone className="h-10 w-10 text-gray-600 mx-auto" />
            <h3 className="text-base font-semibold text-gray-300">No Android devices connected yet</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              Run your personalized setup.bat on your Windows PC and connect your phone with USB debugging enabled.
            </p>
            {user?.role === 'customer' && (
              <a
                href={ApiService.getDownloadScriptUrl()}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium"
              >
                <DownloadCloud className="h-3.5 w-3.5" />
                <span>Get Setup Script</span>
              </a>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {devices.map((device) => (
              <div
                key={device.id}
                className="p-5 rounded-2xl bg-gray-900/60 border border-gray-800/80 hover:border-gray-700 transition flex flex-col justify-between space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gray-800 flex items-center justify-center text-indigo-400 border border-gray-700/60">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-gray-100">{device.device_name}</div>
                      <div className="text-xs text-gray-500">{device.manufacturer} • Android {device.android_version}</div>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                      device.status === 'online'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : device.status === 'streaming'
                        ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                        : 'bg-gray-800 text-gray-400 border-gray-700'
                    }`}
                  >
                    {device.status}
                  </span>
                </div>

                <div className="text-xs text-gray-400 space-y-1 bg-gray-950/40 p-2.5 rounded-lg border border-gray-800/50">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Resolution</span>
                    <span>{device.screen_width}x{device.screen_height}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Connection</span>
                    <span className="uppercase text-[10px] px-1 bg-gray-800 rounded">{device.connection_type}</span>
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <Link
                    to={`/viewer/${device.id}`}
                    className="flex-1 text-center py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 transition"
                  >
                    Open Device
                  </Link>
                  {device.permissions?.can_control && (
                    <Link
                      to={`/viewer/${device.id}?control=true`}
                      className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 font-medium text-xs transition"
                    >
                      Control
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
