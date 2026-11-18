import React, { useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  Smartphone,
  Shield,
  Trash2,
  CheckCircle2,
  RefreshCw,
  Mail,
  Plus,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { Device, AssignedUser } from '../types';

export const AssignedUsersPage: React.FC = () => {
  const [users, setUsers] = useState<AssignedUser[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  // Assign device modal
  const [assignUser, setAssignUser] = useState<AssignedUser | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [canControl, setCanControl] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [uRes, dRes] = await Promise.all([
        ApiService.getAssignedUsers(),
        ApiService.getDevices(),
      ]);
      setUsers(uRes.users || []);
      setDevices(dRes.devices || []);
      if (dRes.devices && dRes.devices.length > 0) {
        setSelectedDeviceId(dRes.devices[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;

    setInviteLoading(true);
    try {
      await ApiService.inviteUser(inviteEmail, inviteName);
      alert(`Invitation sent to ${inviteEmail}!`);
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteName('');
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Failed to invite user.');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleAssignDevice = async () => {
    if (!assignUser || !selectedDeviceId) return;

    try {
      await ApiService.assignDevice(selectedDeviceId, assignUser.user_id, {
        canView: true,
        canControl,
        canShare: false,
      });
      alert('Device assigned successfully!');
      setAssignUser(null);
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Failed to assign device.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Assigned Subordinate Users</h1>
          <p className="text-xs md:text-sm text-gray-400">
            Create subordinate accounts and assign specific devices with granular permissions
          </p>
        </div>

        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition"
        >
          <UserPlus className="h-4 w-4" />
          <span>Invite New User</span>
        </button>
      </div>

      {users.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-800 p-12 text-center space-y-3">
          <Users className="h-12 w-12 text-gray-600 mx-auto" />
          <h3 className="text-lg font-semibold text-gray-300">No subordinate users added</h3>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">
            Click 'Invite New User' to grant team members or external clients scoped access to specific phones.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-gray-900/70 border border-gray-800 overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-950/70 text-gray-400 uppercase tracking-wider text-[10px] border-b border-gray-800">
              <tr>
                <th className="p-4">User</th>
                <th className="p-4">Status</th>
                <th className="p-4">Assigned Devices</th>
                <th className="p-4">Created Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-gray-300">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-800/40 transition">
                  <td className="p-4 font-semibold text-gray-200">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs">
                        {u.email[0].toUpperCase()}
                      </div>
                      <span>{u.email}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      {u.status}
                    </span>
                  </td>
                  <td className="p-4 font-medium text-gray-300">
                    {u.assignedDevicesCount ?? 0} phone(s)
                  </td>
                  <td className="p-4 text-gray-500">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => setAssignUser(u)}
                      className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-indigo-400 hover:text-indigo-300 border border-gray-700 text-xs font-semibold transition"
                    >
                      Assign Devices
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-indigo-400" />
                <span>Invite Subordinate Account</span>
              </h3>
              <button onClick={() => setShowInviteModal(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleInvite} className="space-y-4 text-xs">
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="collaborator@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-gray-300 font-semibold block mb-1">Full Name (Optional)</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-300 text-[11px]">
                Subordinate accounts can ONLY see devices you explicitly assign to them. They cannot access unassigned phones.
              </div>

              <button
                type="submit"
                disabled={inviteLoading}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition"
              >
                {inviteLoading ? 'Sending...' : 'Send Invitation'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Assign Device Modal */}
      {assignUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white">
                Assign Device to {assignUser.email}
              </h3>
              <button onClick={() => setAssignUser(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Select Android Phone</label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200 focus:outline-none focus:border-indigo-500"
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.device_name} ({d.model})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-950/70 border border-gray-800">
                <div>
                  <div className="font-semibold text-gray-200">Grant Remote Control</div>
                  <div className="text-[11px] text-gray-400">User can touch and send keyboard inputs</div>
                </div>
                <input
                  type="checkbox"
                  checked={canControl}
                  onChange={(e) => setCanControl(e.target.checked)}
                  className="h-4 w-4 rounded bg-gray-800 border-gray-700 text-indigo-600 focus:ring-0"
                />
              </div>

              <button
                onClick={handleAssignDevice}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition"
              >
                Confirm Device Assignment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
