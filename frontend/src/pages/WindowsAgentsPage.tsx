import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  DownloadCloud,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Radio,
  RefreshCw,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { Agent } from '../types';

export const WindowsAgentsPage: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const res = await ApiService.getAgents();
      setAgents(res.agents || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke agent "${name}"? It will immediately disconnect and all its attached devices will stop streaming.`)) {
      return;
    }
    setRevokingId(id);
    try {
      await ApiService.revokeAgent(id);
      await loadAgents();
    } catch (e: any) {
      alert(e.message || 'Failed to revoke agent.');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Registered Windows Hosts</h1>
          <p className="text-xs md:text-sm text-gray-400">
            Windows computers running the Vertex Cloud Host Agent & ADB/scrcpy daemon
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={ApiService.getDownloadScriptUrl()}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md transition"
          >
            <DownloadCloud className="h-4 w-4" />
            <span>Download New Setup Script</span>
          </a>
          <button
            onClick={loadAgents}
            className="p-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700 transition"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-800 p-12 text-center space-y-3">
          <Server className="h-12 w-12 text-gray-600 mx-auto" />
          <h3 className="text-lg font-semibold text-gray-300">No Windows hosts enrolled yet</h3>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">
            Download your personalized setup.bat and run it on your Windows computer to register your first host.
          </p>
          <a
            href={ApiService.getDownloadScriptUrl()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-xs"
          >
            <DownloadCloud className="h-4 w-4" />
            <span>Download Setup Script (.bat)</span>
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {agents.map((agent) => {
            const isOnline = agent.status === 'online';
            const isRevoked = agent.status === 'revoked';
            return (
              <div
                key={agent.id}
                className={`rounded-2xl bg-gray-900/70 border p-6 space-y-4 shadow-xl transition ${
                  isRevoked
                    ? 'border-red-900/40 opacity-75'
                    : 'border-gray-800/80 hover:border-gray-700'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gray-800 flex items-center justify-center text-cyan-400 border border-gray-700">
                      <Server className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-gray-100">{agent.computer_name}</h3>
                      <div className="text-xs text-gray-400">
                        {agent.os_version || 'Windows 11'} ({agent.arch}) • Agent v{agent.agent_version}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                      isRevoked
                        ? 'bg-red-500/10 text-red-400 border-red-500/30'
                        : isOnline
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-gray-800 text-gray-400 border-gray-700'
                    }`}
                  >
                    {agent.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-gray-950/60 p-3 rounded-xl border border-gray-800/60">
                  <div>
                    <span className="text-gray-500 block text-[10px] uppercase">Registered Devices</span>
                    <span className="font-semibold text-gray-300">{agent.deviceCount ?? 0} phone(s)</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px] uppercase">Host IP</span>
                    <span className="font-semibold text-gray-300">{agent.ip_address || '127.0.0.1'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px] uppercase">Cloudflare Tunnel</span>
                    <span className="font-semibold text-cyan-400">
                      {agent.cloudflare_tunnel_id ? 'Configured & Encrypted' : 'Auto-routed'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px] uppercase">Heartbeat</span>
                    <span className="font-semibold text-gray-300 text-[11px]">Active</span>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  {!isRevoked ? (
                    <button
                      onClick={() => handleRevoke(agent.id, agent.computer_name)}
                      disabled={revokingId === agent.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 text-xs font-semibold transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{revokingId === agent.id ? 'Revoking...' : 'Revoke Host'}</span>
                    </button>
                  ) : (
                    <span className="text-xs text-red-400 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Host Credentials Permanently Revoked
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
