import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Smartphone,
  Server,
  Share2,
  Key,
  RefreshCw,
  UserPlus,
  Play,
  Copy,
  Check,
  ShieldAlert,
  Sliders,
  ExternalLink,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Device } from '../types';

export const DevicesPage: React.FC = () => {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Share Modal State
  const [shareModalDevice, setShareModalDevice] = useState<Device | null>(null);
  const [allowControl, setAllowControl] = useState(true);
  const [customPin, setCustomPin] = useState('');
  const [createdShare, setCreatedShare] = useState<{ url: string; pin: string } | null>(null);
  const [shareLoading, setShareLoading] = useState(false);

  // Assign Modal State
  const [assignModalDevice, setAssignModalDevice] = useState<Device | null>(null);
  const [assignedUsersList, setAssignedUsersList] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [assignControl, setAssignControl] = useState(false);
  const [assignMsg, setAssignMsg] = useState('');

  // Worker Credentials Modal
  const [workerCredsModal, setWorkerCredsModal] = useState<{
    deviceName: string;
    url: string;
    pin: string;
    fullUrl: string;
  } | null>(null);

  useEffect(() => {
    loadDevices();
  }, [user]);

  const loadDevices = async () => {
    setLoading(true);
    try {
      const res = await ApiService.getDevices();
      setDevices(res.devices || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenShareModal = (device: Device) => {
    setShareModalDevice(device);
    setCreatedShare(null);
    setCustomPin('');
    setAllowControl(true);
  };

  const handleCreateShare = async () => {
    if (!shareModalDevice) return;
    setShareLoading(true);
    try {
      const res = await ApiService.createShare(shareModalDevice.id, {
        allowControl,
        customPin: customPin || undefined,
        expirationHours: 48,
      });
      const fullUrl = `${window.location.origin}/share/${res.share.share_token}`;
      setCreatedShare({
        url: fullUrl,
        pin: res.pin,
      });
    } catch (e: any) {
      alert(e.message || 'Failed to create share link.');
    } finally {
      setShareLoading(false);
    }
  };

  const handleOpenAssignModal = async (device: Device) => {
    setAssignModalDevice(device);
    setAssignMsg('');
    try {
      const res = await ApiService.getAssignedUsers();
      setAssignedUsersList(res.users || []);
      if (res.users && res.users.length > 0) {
        setSelectedUserId(res.users[0].user_id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAssignUser = async () => {
    if (!assignModalDevice || !selectedUserId) return;
    try {
      await ApiService.assignDevice(assignModalDevice.id, selectedUserId, {
        canView: true,
        canControl: assignControl,
        canShare: false,
      });
      setAssignMsg('Device successfully assigned to user!');
      setTimeout(() => {
        setAssignModalDevice(null);
        setAssignMsg('');
      }, 1500);
    } catch (e: any) {
      alert(e.message || 'Failed to assign device.');
    }
  };

  const copyDeviceCredentials = async (device: Device) => {
    try {
      const creds = await ApiService.getDeviceCredentials(device.id);
      const fullUrl = `${window.location.origin}${creds.url}`;
      setWorkerCredsModal({
        deviceName: device.device_name,
        url: creds.url,
        pin: creds.pin,
        fullUrl,
      });
    } catch (e: any) {
      alert(e.message || 'Failed to get credentials.');
    }
  };

  const isCustomer = user?.role === 'customer' || user?.role === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Android Device Fleet</h1>
          <p className="text-xs md:text-sm text-gray-400">
            {user?.role === 'assigned_user'
              ? 'Devices explicitly assigned to your subordinate account'
              : `Managing ${devices.length} registered Android device(s)`}
          </p>
        </div>

        <button
          onClick={loadDevices}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700 text-xs transition"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Fleet</span>
        </button>
      </div>

      {devices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-800 p-12 text-center space-y-3">
          <Smartphone className="h-12 w-12 text-gray-600 mx-auto" />
          <h3 className="text-lg font-semibold text-gray-300">No devices available</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            {user?.role === 'assigned_user'
              ? 'Your account does not have any assigned devices yet. Ask your account owner to assign an Android phone to you.'
              : 'Plug an Android phone into your Windows computer with USB Debugging enabled. The agent will discover it automatically.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {devices.map((device) => {
            const isOnline = device.status === 'online' || device.status === 'streaming';
            return (
              <div
                key={device.id}
                className="rounded-2xl bg-gray-900/70 border border-gray-800/80 hover:border-gray-700 transition flex flex-col justify-between overflow-hidden shadow-xl"
              >
                {/* Header */}
                <div className="p-5 pb-3 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-xl bg-gradient-to-tr from-gray-800 to-gray-700/80 flex items-center justify-center text-indigo-400 border border-gray-700 shadow-inner">
                        <Smartphone className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-gray-100">{device.device_name}</h3>
                        <div className="text-xs text-gray-400">
                          {device.manufacturer} • Model: {device.model}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        device.status === 'streaming'
                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                          : isOnline
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}
                    >
                      {device.status}
                    </span>
                  </div>

                  {/* Device Specs Table */}
                  <div className="grid grid-cols-2 gap-2 text-xs bg-gray-950/60 p-3 rounded-xl border border-gray-800/60">
                    <div className="col-span-2 flex items-center justify-between bg-gray-900/60 px-2 py-1.5 rounded-lg border border-gray-800/80">
                      <span className="text-gray-400 font-semibold text-[10px] uppercase">Device Serial</span>
                      <span className="font-mono text-emerald-400 font-bold select-all text-xs bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/30">
                        {device.adb_serial}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-[10px] uppercase">Android OS</span>
                      <span className="font-semibold text-gray-300">Android {device.android_version}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-[10px] uppercase">Resolution</span>
                      <span className="font-semibold text-gray-300">{device.screen_width}x{device.screen_height}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-[10px] uppercase">Link Type</span>
                      <span className="font-semibold text-gray-300 uppercase">{device.connection_type}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-[10px] uppercase">Last Seen</span>
                      <span className="font-semibold text-gray-300 text-[11px]">Active</span>
                    </div>
                  </div>
                </div>

                {/* Actions Bar */}
                <div className="p-5 pt-0 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      to={`/viewer/${device.id}`}
                      className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 transition"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Open Device</span>
                    </Link>

                    {device.permissions?.can_control ? (
                      <Link
                        to={`/viewer/${device.id}?control=true`}
                        className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 font-semibold text-xs transition"
                      >
                        <Sliders className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Remote Control</span>
                      </Link>
                    ) : (
                      <div className="flex items-center justify-center text-[11px] text-gray-500 py-2 border border-gray-800/60 rounded-xl">
                        View Only
                      </div>
                    )}
                  </div>

                  {/* Owner Controls */}
                  {isCustomer ? (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleOpenShareModal(device)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-gray-800/60 hover:bg-gray-800 text-gray-300 border border-gray-800 text-[11px] transition"
                        title="Generate secure sharing link & PIN"
                      >
                        <Share2 className="h-3 w-3 text-cyan-400" />
                        <span>Share Link</span>
                      </button>

                      <button
                        onClick={() => handleOpenAssignModal(device)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-gray-800/60 hover:bg-gray-800 text-gray-300 border border-gray-800 text-[11px] transition"
                        title="Assign to subordinate user account"
                      >
                        <UserPlus className="h-3 w-3 text-indigo-400" />
                        <span>Assign User</span>
                      </button>
                    </div>
                  ) : (
                    /* Assigned User Actions */
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => copyDeviceCredentials(device)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition"
                      >
                        <Copy className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Copy Link & PIN</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Share Modal */}
      {shareModalDevice && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Share2 className="h-4 w-4 text-indigo-400" />
                <span>Share {shareModalDevice.device_name} (SN: {shareModalDevice.adb_serial})</span>
              </h3>
              <button
                onClick={() => setShareModalDevice(null)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {!createdShare ? (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="text-gray-300 font-semibold block mb-1">Custom Access PIN (Optional 6 digits)</label>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="Leave blank to auto-generate"
                    value={customPin}
                    onChange={(e) => setCustomPin(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">If blank, a secure 6-digit PIN will be generated.</p>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-gray-950/70 border border-gray-800">
                  <div>
                    <div className="font-semibold text-gray-200">Allow Remote Control</div>
                    <div className="text-[11px] text-gray-400">Recipient can touch and type on the phone</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowControl}
                    onChange={(e) => setAllowControl(e.target.checked)}
                    className="h-4 w-4 rounded bg-gray-800 border-gray-700 text-indigo-600 focus:ring-0"
                  />
                </div>

                <button
                  onClick={handleCreateShare}
                  disabled={shareLoading}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition"
                >
                  {shareLoading ? 'Generating...' : 'Generate Share Link & PIN'}
                </button>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs">
                  Access link generated! Share both the URL and PIN with the recipient.
                </div>

                <div className="space-y-2">
                  <label className="text-gray-400 font-semibold block">Share URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={createdShare.url}
                      className="w-full px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-gray-200 font-mono text-[11px]"
                    />
                    <button
                      onClick={() => handleCopy(createdShare.url, 'share_url')}
                      className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs"
                    >
                      {copiedId === 'share_url' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-gray-400 font-semibold block">Access PIN</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={createdShare.pin}
                      className="w-full px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-indigo-400 font-mono font-bold tracking-widest text-sm"
                    />
                    <button
                      onClick={() => handleCopy(createdShare.pin, 'share_pin')}
                      className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs"
                    >
                      {copiedId === 'share_pin' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => setShareModalDevice(null)}
                    className="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-xs"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assign User Modal */}
      {assignModalDevice && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-indigo-400" />
                <span>Assign {assignModalDevice.device_name} (SN: {assignModalDevice.adb_serial})</span>
              </h3>
              <button
                onClick={() => setAssignModalDevice(null)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {assignMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs">
                {assignMsg}
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="text-gray-300 font-semibold block mb-1">Select Subordinate User</label>
                {assignedUsersList.length === 0 ? (
                  <p className="text-gray-500 text-xs">
                    No subordinate users exist. Invite one in the 'Assigned Users' tab first.
                  </p>
                ) : (
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200 focus:outline-none focus:border-indigo-500"
                  >
                    {assignedUsersList.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-950/70 border border-gray-800">
                <div>
                  <div className="font-semibold text-gray-200">Grant Remote Control</div>
                  <div className="text-[11px] text-gray-400">User can interact and send touch events</div>
                </div>
                <input
                  type="checkbox"
                  checked={assignControl}
                  onChange={(e) => setAssignControl(e.target.checked)}
                  className="h-4 w-4 rounded bg-gray-800 border-gray-700 text-indigo-600 focus:ring-0"
                />
              </div>

              <button
                onClick={handleAssignUser}
                disabled={!selectedUserId}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition"
              >
                Confirm Device Assignment
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Worker Credentials Modal */}
      {workerCredsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Key className="h-4 w-4 text-cyan-400" />
                <span>Assigned Stream: {workerCredsModal.deviceName}</span>
              </h3>
              <button
                onClick={() => setWorkerCredsModal(null)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block text-[11px]">Direct Share URL</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={workerCredsModal.fullUrl}
                    className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-cyan-300 font-mono text-[11px] select-all focus:outline-none"
                  />
                  <button
                    onClick={() => handleCopy(workerCredsModal.fullUrl, 'work-url')}
                    className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
                    title="Copy URL"
                  >
                    {copiedId === 'work-url' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-gray-400 font-semibold block text-[11px]">Device Access PIN</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={workerCredsModal.pin}
                    className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-yellow-300 font-mono text-lg font-bold tracking-widest text-center select-all focus:outline-none"
                  />
                  <button
                    onClick={() => handleCopy(workerCredsModal.pin, 'work-pin')}
                    className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
                    title="Copy PIN"
                  >
                    {copiedId === 'work-pin' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-gray-950/80 border border-gray-800 rounded-xl text-gray-400 text-[11px] leading-relaxed">
                You can open this stream link from any browser or smartphone anywhere in the world. As long as your assignment remains active, entering this PIN grants immediate viewing and remote control.
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const combined = `Stream URL: ${workerCredsModal.fullUrl}\nAccess PIN: ${workerCredsModal.pin}`;
                    handleCopy(combined, 'work-all');
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                >
                  {copiedId === 'work-all' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedId === 'work-all' ? 'Copied Both to Clipboard!' : 'Copy Link & PIN'}</span>
                </button>

                <a
                  href={workerCredsModal.fullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold text-xs flex items-center gap-1 transition"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Open Stream</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
