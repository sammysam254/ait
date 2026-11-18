import React, { useEffect, useState } from 'react';
import { FileText, Shield, Clock, RefreshCw } from 'lucide-react';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { AuditLog } from '../types';

export const ActivityLogsPage: React.FC = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, [user]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await ApiService.getAdminAuditLogs();
      setLogs(res.logs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Security & Activity Audit Logs</h1>
          <p className="text-xs md:text-sm text-gray-400">
            Immutable audit trail of device connections, streaming sessions, and enrollment actions
          </p>
        </div>
        <button
          onClick={loadLogs}
          className="p-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="rounded-2xl bg-gray-900/70 border border-gray-800 overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-950/70 text-gray-400 uppercase tracking-wider text-[10px] border-b border-gray-800">
            <tr>
              <th className="p-4">Action</th>
              <th className="p-4">Resource</th>
              <th className="p-4">Details</th>
              <th className="p-4">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 text-gray-300">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-800/40 transition">
                <td className="p-4 font-mono font-bold text-indigo-400">
                  {log.action}
                </td>
                <td className="p-4 uppercase text-[10px] text-gray-400 font-semibold">
                  {log.resource_type}
                </td>
                <td className="p-4 text-gray-400 font-mono text-[11px] truncate max-w-xs">
                  {JSON.stringify(log.details)}
                </td>
                <td className="p-4 text-gray-500 whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
