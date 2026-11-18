import React, { useEffect, useState } from 'react';
import {
  Share2,
  Copy,
  Check,
  RefreshCw,
  Key,
  Trash2,
  ExternalLink,
  Eye,
  EyeOff,
  ShieldAlert,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Device } from '../types';

export const SharedAccessPage: React.FC = () => {
  const { user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [sharesMap, setSharesMap] = useState<Record<string, any>>({});
  const [visiblePins, setVisiblePins] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadShares();
  }, [user]);

  const loadShares = async () => {
    setLoading(true);
    try {
      const devRes = await ApiService.getDevices();
      const devList = devRes.devices || [];
      setDevices(devList);

      const map: Record<string, any> = {};
      for (const dev of devList) {
        try {
          const shareRes = await ApiService.getDeviceShare(dev.id);
          if (shareRes.share) {
            map[dev.id] = shareRes.share;
          }
        } catch (e) {}
      }
      setSharesMap(map);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const togglePin = (id: string) => {
    setVisiblePins(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRotatePin = async (shareId: string, deviceId: string) => {
    try {
      const res = await ApiService.rotatePin(shareId);
      setSharesMap(prev => ({
        ...prev,
        [deviceId]: res.share,
      }));
      alert(`PIN Rotated! New PIN: ${res.newPin}`);
    } catch (e: any) {
      alert(e.message || 'Failed to rotate PIN.');
    }
  };

  const handleRotateToken = async (shareId: string, deviceId: string) => {
    try {
      const res = await ApiService.rotateToken(shareId);
      setSharesMap(prev => ({
        ...prev,
        [deviceId]: res.share,
      }));
      alert('Share URL token successfully rotated. Old links are now invalid.');
    } catch (e: any) {
      alert(e.message || 'Failed to rotate share link.');
    }
  };

  const handleRevoke = async (shareId: string, deviceId: string) => {
    if (!confirm('Are you sure you want to revoke this share link? Viewers will immediately lose access.')) return;
    try {
      await ApiService.revokeShare(shareId);
      setSharesMap(prev => {
        const copy = { ...prev };
        delete copy[deviceId];
        return copy;
      });
      alert('Sharing session successfully revoked.');
    } catch (e: any) {
      alert(e.message || 'Failed to revoke share.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Device Sharing Links</h1>
          <p className="text-xs md:text-sm text-gray-400">
            Secure temporary public access links with cryptographic PIN protection and attempt limits
          </p>
        </div>
        <button
          onClick={loadShares}
          className="p-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {Object.keys(sharesMap).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-800 p-12 text-center space-y-3">
          <Share2 className="h-12 w-12 text-gray-600 mx-auto" />
          <h3 className="text-lg font-semibold text-gray-300">No active device share links</h3>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">
            Go to the Devices page and click 'Share Link' on any Android phone to generate a private URL and PIN.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(sharesMap).map(([deviceId, share]) => {
            const device = devices.find(d => d.id === deviceId);
            const fullUrl = `${window.location.origin}/share/${share.share_token}`;
            const showPin = visiblePins[share.id];

            return (
              <div
                key={share.id}
                className="rounded-2xl bg-gray-900/70 border border-gray-800 p-5 space-y-4 shadow-xl"
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-800 pb-3">
                  <div>
                    <h3 className="font-bold text-base text-gray-100 flex items-center gap-2">
                      <span>{device?.device_name || 'Android Device'}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 font-normal">
                        {share.allow_control ? 'Full Remote Control' : 'View Only'}
                      </span>
                    </h3>
                    <div className="text-xs text-gray-400">
                      Expires: {new Date(share.expires_at).toLocaleString()} • Uses: {share.current_uses}/{share.max_uses}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={fullUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition"
                    >
                      <span>Open Link</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <button
                      onClick={() => handleRevoke(share.id, deviceId)}
                      className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 transition"
                      title="Revoke Share"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* URL and PIN display */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Share URL */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-gray-400 font-semibold">
                      <span>Share URL</span>
                      <button
                        onClick={() => handleRotateToken(share.id, deviceId)}
                        className="text-indigo-400 hover:text-indigo-300 text-[11px] flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Rotate URL</span>
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={fullUrl}
                        className="w-full px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-gray-300 font-mono text-[11px]"
                      />
                      <button
                        onClick={() => handleCopy(fullUrl, `url_${share.id}`)}
                        className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200"
                      >
                        {copiedKey === `url_${share.id}` ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Access PIN */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-gray-400 font-semibold">
                      <span>Access PIN</span>
                      <button
                        onClick={() => handleRotatePin(share.id, deviceId)}
                        className="text-indigo-400 hover:text-indigo-300 text-[11px] flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Rotate PIN</span>
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <div className="relative w-full">
                        <input
                          type={showPin ? 'text' : 'password'}
                          readOnly
                          value={share.pin_preview || '******'}
                          className="w-full px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-indigo-400 font-mono font-bold tracking-widest text-sm pr-10"
                        />
                        <button
                          onClick={() => togglePin(share.id)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                        >
                          {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <button
                        onClick={() => handleCopy(share.pin_preview || '', `pin_${share.id}`)}
                        className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200"
                      >
                        {copiedKey === `pin_${share.id}` ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
