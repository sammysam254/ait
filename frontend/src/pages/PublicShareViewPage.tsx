import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Smartphone,
  Shield,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { DeviceViewerPage } from './DeviceViewerPage';

export const PublicShareViewPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  // State
  const [loading, setLoading] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [unavailableError, setUnavailableError] = useState<string | null>(null);
  const [shareInfo, setShareInfo] = useState<any>(null);

  // PIN Form
  const [pin, setPin] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Authenticated Session
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [canControl, setCanControl] = useState(false);

  useEffect(() => {
    if (token) {
      inspectToken();
    }
  }, [token]);

  const inspectToken = async () => {
    setLoading(true);
    try {
      const data = await ApiService.inspectPublicShare(token!);
      if (data.valid) {
        setTokenValid(true);
        setShareInfo(data);
      } else {
        setTokenValid(false);
        setUnavailableError(data.error);
      }
    } catch (e: any) {
      setTokenValid(false);
      setUnavailableError(
        'ACCESS UNAVAILABLE\n\nThis device access link is no longer active.\nThe owner may have revoked or renewed this sharing session.\nPlease request a new access link from the device owner.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || pin.length < 4) {
      setPinError('Please enter the full PIN provided by the device owner.');
      return;
    }

    setPinVerifying(true);
    setPinError(null);

    try {
      const res = await ApiService.verifySharePin(token!, pin);
      if (res.success && res.sessionToken) {
        setSessionToken(res.sessionToken);
        setDeviceId(res.deviceId);
        setCanControl(res.allowControl);
      } else {
        setPinError(res.error || 'Incorrect PIN.');
      }
    } catch (e: any) {
      setPinError(e.message || 'Incorrect access PIN.');
    } finally {
      setPinVerifying(false);
    }
  };

  // 1. Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
        <Smartphone className="h-10 w-10 text-indigo-500 animate-pulse mb-4" />
        <p className="text-gray-400 text-sm">Verifying secure access link...</p>
      </div>
    );
  }

  // 2. Unavailable / Expired / Revoked Error Screen
  if (!tokenValid) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full rounded-3xl bg-gray-900 border border-red-900/40 p-8 text-center space-y-4 shadow-2xl">
          <div className="h-14 w-14 rounded-2xl bg-red-500/10 text-red-400 flex items-center justify-center mx-auto border border-red-500/20">
            <Shield className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">ACCESS UNAVAILABLE</h2>
          <div className="text-xs text-gray-300 leading-relaxed whitespace-pre-line bg-gray-950/80 p-4 rounded-2xl border border-gray-800">
            {unavailableError || 'This device access link is no longer active.\nThe owner may have revoked or renewed this sharing session.\nPlease request a new access link from the device owner.'}
          </div>
          <p className="text-[11px] text-gray-500">
            Protected by Vertex Cloud Device Security
          </p>
        </div>
      </div>
    );
  }

  // 3. PIN Verification Screen (Prior to streaming)
  if (!sessionToken || !deviceId) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full rounded-3xl bg-gray-900 border border-gray-800 p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <div className="h-12 w-12 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto border border-indigo-500/30">
              <Lock className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Protected Device Access</h2>
            <div className="text-xs text-gray-400 space-y-1">
              <div>{shareInfo?.deviceName || 'Remote Android Device'}</div>
              {shareInfo?.adbSerial && (
                <div className="font-mono text-emerald-400 font-bold text-[11px] select-all bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30 inline-block">
                  SN: {shareInfo.adbSerial}
                </div>
              )}
              <div className="text-[11px] text-gray-500 pt-1">
                Enter the security PIN provided by the device owner to open the remote Android stream.
              </div>
            </div>
          </div>

          <form onSubmit={handleVerifyPin} className="space-y-4">
            <div>
              <label className="text-gray-300 font-semibold block text-xs mb-1.5 text-center">
                Access PIN
              </label>
              <input
                type="password"
                maxLength={8}
                autoFocus
                placeholder="••••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full text-center tracking-widest text-2xl font-mono px-4 py-3 rounded-xl bg-gray-950 border border-gray-800 text-indigo-400 focus:outline-none focus:border-indigo-500 shadow-inner"
              />
            </div>

            {pinError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs text-center flex items-center justify-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{pinError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={pinVerifying}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95"
            >
              {pinVerifying ? 'Verifying PIN...' : 'Authenticate & Open Device'}
            </button>
          </form>

          <div className="text-center text-[11px] text-gray-500">
            Permissions: {shareInfo?.allowControl ? 'Interactive Remote Control' : 'View Only Stream'}
          </div>
        </div>
      </div>
    );
  }

  // 4. Authenticated Live Stream Viewer using full DeviceViewer engine (H.264 + Scrcpy Control)
  return (
    <DeviceViewerPage
      shareSessionToken={sessionToken}
      shareDeviceId={deviceId}
      shareAllowControl={canControl}
      shareDeviceName={shareInfo?.deviceName}
    />
  );
};

export default PublicShareViewPage;
