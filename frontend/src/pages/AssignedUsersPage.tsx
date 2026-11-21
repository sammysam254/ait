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
  Copy,
  Check,
  Key,
  XCircle,
  ExternalLink,
  Lock,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { Device, AssignedUser } from '../types';

interface ExtendedAssignedUser extends AssignedUser {
  assignedDevicesCount?: number;
  assignedDevices?: Array<{
    assignmentId: string;
    deviceId: string;
    deviceName: string;
    adbSerial?: string;
    model: string;
    status: string;
    canView: boolean;
    canControl: boolean;
    canShare: boolean;
  }>;
}

export const AssignedUsersPage: React.FC = () => {
  const [users, setUsers] = useState<ExtendedAssignedUser[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email: string; inviteUrl: string; token: string } | null>(null);

  // Assign device modal
  const [assignUser, setAssignUser] = useState<ExtendedAssignedUser | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [canControl, setCanControl] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);

  // Device Credentials (URL & PIN) Modal
  const [credentialsModal, setCredentialsModal] = useState<{
    deviceName: string;
    url: string;
    pin: string;
    fullUrl: string;
  } | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;

    setInviteLoading(true);
    try {
      const res = await ApiService.inviteUser(inviteEmail, inviteName);
      setInviteResult({
        email: inviteEmail,
        inviteUrl: res.inviteUrl,
        token: res.token,
      });
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

    setAssignLoading(true);
    try {
      await ApiService.assignDevice(selectedDeviceId, assignUser.user_id, {
        canView: true,
        canControl,
        canShare: false,
      });
      setAssignUser(null);
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Failed to assign device.');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string, userId: string, deviceName: string) => {
    if (!confirm(`Are you sure you want to revoke access to "${deviceName}" for this user?`)) return;

    try {
      await ApiService.revokeAssignment(deviceId, userId);
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Failed to revoke device access.');
    }
  };

  const handleRevokeUser = async (user: ExtendedAssignedUser) => {
    if (!confirm(`Revoke all access for ${user.email}?\nThis will permanently unassign all devices and delete their worker profile from your organization.`)) {
      return;
    }

    try {
      await ApiService.revokeUser(user.user_id);
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Failed to revoke user.');
    }
  };

  const handleShowCredentials = async (deviceId: string, deviceName: string) => {
    try {
      const creds = await ApiService.getDeviceCredentials(deviceId);
      const fullUrl = `${window.location.origin}${creds.url}`;
      setCredentialsModal({
        deviceName,
        url: creds.url,
        pin: creds.pin,
        fullUrl,
      });
    } catch (e: any) {
      alert(e.message || 'Failed to retrieve device access PIN.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Assigned Subordinate Users</h1>
          <p className="text-xs md:text-sm text-gray-400">
            Invite workers to your organization, assign specific Android phones, and manage access credentials
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800 text-gray-300 hover:text-white border border-gray-700 text-xs transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => {
              setInviteResult(null);
              setShowInviteModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95"
          >
            <UserPlus className="h-4 w-4" />
            <span>Invite Subordinate Worker</span>
          </button>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-800 p-12 text-center space-y-3">
          <Users className="h-12 w-12 text-gray-600 mx-auto" />
          <h3 className="text-lg font-semibold text-gray-300">No subordinate workers invited yet</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            Click 'Invite Subordinate Worker' to send an email invitation with an automatic registration link. Once signed up, they are routed to your organization and can only access the phones you assign to them.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-gray-900/70 border border-gray-800 overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-950/70 text-gray-400 uppercase tracking-wider text-[10px] border-b border-gray-800">
              <tr>
                <th className="p-4">Subordinate Worker</th>
                <th className="p-4">Account Status</th>
                <th className="p-4">Assigned Android Devices</th>
                <th className="p-4">Joined / Invited</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-gray-300">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-800/40 transition">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white flex items-center justify-center font-bold text-xs shadow-md">
                        {u.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-200">{u.email}</div>
                        <div className="text-[11px] text-gray-500">ID: {u.user_id.slice(0, 8)}...</div>
                      </div>
                    </div>
                  </td>

                  <td className="p-4">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
                        u.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}
                    >
                      {u.status === 'active' ? '● Active & Verified' : '○ Pending Registration'}
                    </span>
                  </td>

                  <td className="p-4">
                    {u.assignedDevices && u.assignedDevices.length > 0 ? (
                      <div className="space-y-1.5 max-w-xs">
                        {u.assignedDevices.map((d) => (
                          <div
                            key={d.deviceId}
                            className="flex items-center justify-between gap-2 p-1.5 px-2.5 rounded-lg bg-gray-950/60 border border-gray-800/80 text-[11px]"
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <Smartphone className="h-3 w-3 text-indigo-400 shrink-0" />
                              <span className="font-medium text-gray-200 truncate">{d.deviceName}</span>
                              {d.adbSerial && (
                                <span className="font-mono text-emerald-400 font-bold text-[9px] bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/30 shrink-0 select-all">
                                  {d.adbSerial}
                                </span>
                              )}
                              <span className="text-[10px] text-gray-500">({d.canControl ? 'Control' : 'View'})</span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handleShowCredentials(d.deviceId, d.deviceName)}
                                title="Get share link & active PIN"
                                className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-cyan-400 transition"
                              >
                                <Key className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => handleRevokeDevice(d.deviceId, u.user_id, d.deviceName)}
                                title="Revoke this device"
                                className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-red-400 transition"
                              >
                                <XCircle className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-500 italic text-[11px]">No devices assigned yet</span>
                    )}
                  </td>

                  <td className="p-4 text-gray-400">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>

                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setAssignUser(u)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition"
                      >
                        + Assign Device
                      </button>

                      <button
                        onClick={() => handleRevokeUser(u)}
                        title="Revoke user account & all assignments"
                        className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-indigo-400" />
                <span>Invite Subordinate Worker</span>
              </h3>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteResult(null);
                }}
                className="text-gray-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {inviteResult ? (
              <div className="space-y-4 text-xs">
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Invitation Successfully Generated!</span>
                  </div>
                  <p className="text-gray-300 text-[11px] leading-relaxed">
                    An email was dispatched to <strong className="text-white">{inviteResult.email}</strong>. When they click the link, their email is pre-filled, and they set their password to immediately access your fleet.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-gray-400 font-semibold block text-[11px] uppercase tracking-wider">
                    Direct Registration Link (Click to Copy)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inviteResult.inviteUrl}
                      className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-indigo-300 font-mono text-[11px] select-all focus:outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(inviteResult.inviteUrl, 'invite-url')}
                      className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1 shrink-0 transition"
                    >
                      {copiedKey === 'invite-url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedKey === 'invite-url' ? 'Copied!' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setShowInviteModal(false);
                    setInviteResult(null);
                  }}
                  className="w-full py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-xs transition"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleInvite} className="space-y-4 text-xs">
                <div>
                  <label className="text-gray-300 font-semibold block mb-1">Worker's Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="worker@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-gray-300 font-semibold block mb-1">Full Name (Optional)</label>
                  <input
                    type="text"
                    placeholder="John Worker"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-300 text-[11px] leading-relaxed">
                  The invited user will be routed directly to your organization upon registration. They will only see phones that you assign to them.
                </div>

                <button
                  type="submit"
                  disabled={inviteLoading}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95 disabled:opacity-50"
                >
                  {inviteLoading ? 'Generating Invitation & Sending Email...' : 'Send Team Invitation →'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Assign Device Modal */}
      {assignUser && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-indigo-400" />
                <span>Assign Device to {assignUser.email}</span>
              </h3>
              <button onClick={() => setAssignUser(null)} className="text-gray-400 hover:text-white text-sm">✕</button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Select Android Phone</label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500"
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.device_name} ({d.model}) • SN: {d.adb_serial} • {d.status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between p-3.5 rounded-xl bg-gray-950/70 border border-gray-800">
                <div>
                  <div className="font-semibold text-gray-200">Grant Remote Touch & Control</div>
                  <div className="text-[11px] text-gray-400">Allows user to swipe, tap, and interact live with the screen</div>
                </div>
                <input
                  type="checkbox"
                  checked={canControl}
                  onChange={(e) => setCanControl(e.target.checked)}
                  className="h-4 w-4 rounded bg-gray-800 border-gray-700 text-indigo-600 focus:ring-0 cursor-pointer"
                />
              </div>

              <button
                onClick={handleAssignDevice}
                disabled={assignLoading}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95 disabled:opacity-50"
              >
                {assignLoading ? 'Assigning...' : 'Confirm Device Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Credentials (URL & PIN) Modal */}
      {credentialsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Key className="h-4 w-4 text-cyan-400" />
                <span>Active Credentials: {credentialsModal.deviceName}</span>
              </h3>
              <button onClick={() => setCredentialsModal(null)} className="text-gray-400 hover:text-white text-sm">✕</button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block text-[11px]">Share Stream URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={credentialsModal.fullUrl}
                    className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-cyan-300 font-mono text-[11px] select-all focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(credentialsModal.fullUrl, 'url')}
                    className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
                    title="Copy URL"
                  >
                    {copiedKey === 'url' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block text-[11px]">Access Verification PIN</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={credentialsModal.pin}
                    className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-yellow-300 font-mono text-base font-bold tracking-widest text-center select-all focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(credentialsModal.pin, 'pin')}
                    className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
                    title="Copy PIN"
                  >
                    {copiedKey === 'pin' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-950/80 border border-gray-800 rounded-xl text-gray-400 text-[11px] leading-relaxed">
                As long as this device session remains active, any user with this link and PIN can connect and view/control the stream from anywhere.
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const combined = `Stream URL: ${credentialsModal.fullUrl}\nPIN: ${credentialsModal.pin}`;
                    copyToClipboard(combined, 'all');
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                >
                  {copiedKey === 'all' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedKey === 'all' ? 'Copied Both to Clipboard!' : 'Copy Link & PIN'}</span>
                </button>

                <a
                  href={credentialsModal.fullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-xs flex items-center gap-1 transition"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Test Link</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
