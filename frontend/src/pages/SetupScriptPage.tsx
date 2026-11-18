import React, { useEffect, useState } from 'react';
import {
  DownloadCloud,
  Terminal,
  ShieldCheck,
  RefreshCw,
  Copy,
  Check,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export const SetupScriptPage: React.FC = () => {
  const { user } = useAuth();
  const [scriptInfo, setScriptInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    loadInfo();
  }, [user]);

  const loadInfo = async () => {
    setLoading(true);
    try {
      const data = await ApiService.getScriptInfo();
      setScriptInfo(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateToken = async () => {
    if (!confirm('Regenerating will issue a new single-use setup script token. Continue?')) return;
    setGenerating(true);
    try {
      await ApiService.generateNewToken('Manual Dashboard Regeneration');
      await loadInfo();
      alert('New enrollment token successfully generated!');
    } catch (e: any) {
      alert(e.message || 'Failed to regenerate token.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const downloadUrl = ApiService.getDownloadScriptUrl();

  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await ApiService.downloadSetupScript();
    } catch (err: any) {
      console.warn('Direct blob download error, falling back to window.open:', err);
      window.open(downloadUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Automated Windows Setup Script</h1>
        <p className="text-xs md:text-sm text-gray-400">
          Personalized, single-use automated setup batch file for your organization ({user?.organizationName})
        </p>
      </div>

      {/* Main Download Card */}
      <div className="rounded-3xl bg-gradient-to-br from-indigo-900/50 via-gray-900 to-gray-950 border border-indigo-500/30 p-6 md:p-8 space-y-6 shadow-2xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Multi-Tenant Scoped Token Ready</span>
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              Download Your Unique Host Agent Installer
            </h2>
            <p className="text-xs md:text-sm text-gray-300">
              Running this script will automatically check Windows, install the cloud agent, configure ADB and scrcpy 3.3.4, and register all connected Android phones under your account.
            </p>
          </div>

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="shrink-0 flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-xl shadow-indigo-600/40 transition transform active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <DownloadCloud className={`h-5 w-5 ${downloading ? 'animate-bounce' : ''}`} />
            <span>{downloading ? 'DOWNLOADING...' : 'DOWNLOAD SETUP.BAT'}</span>
          </button>
        </div>

        {/* Token Metadata Card */}
        {scriptInfo?.latestToken && (
          <div className="p-4 rounded-2xl bg-gray-950/70 border border-gray-800 text-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 pb-2">
              <div className="font-semibold text-gray-200">Active Enrollment Details</div>
              <div className="text-gray-400">
                Generated: {new Date(scriptInfo.latestToken.created_at).toLocaleString()}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <span className="text-gray-500 block text-[10px] uppercase">Token ID</span>
                <span className="font-mono text-gray-300">{scriptInfo.latestToken.id.slice(0, 16)}...</span>
              </div>
              <div>
                <span className="text-gray-500 block text-[10px] uppercase">Expires At</span>
                <span className="text-amber-400 font-semibold">{new Date(scriptInfo.latestToken.expires_at).toLocaleTimeString()}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-[10px] uppercase">Enrollment Status</span>
                <span className="text-emerald-400 font-semibold">
                  {scriptInfo.latestToken.used_at ? 'Enrolled (Host Active)' : 'Pending Execution'}
                </span>
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between">
              <span className="text-[11px] text-gray-500">
                Single-use security token prevents unauthorized machine registrations.
              </span>
              <button
                onClick={handleRegenerateToken}
                disabled={generating}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
              >
                <RefreshCw className={`h-3 w-3 ${generating ? 'animate-spin' : ''}`} />
                <span>Regenerate Token</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3-Step Setup Instructions */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-white">How It Works in 3 Quick Steps</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-gray-900/60 border border-gray-800 space-y-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center text-sm">
              1
            </div>
            <h4 className="font-bold text-sm text-gray-200">Download & Run setup.bat</h4>
            <p className="text-xs text-gray-400">
              Download your custom setup script and double click to run it on your 64-bit Windows computer.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-gray-900/60 border border-gray-800 space-y-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center text-sm">
              2
            </div>
            <h4 className="font-bold text-sm text-gray-200">Connect Android Devices</h4>
            <p className="text-xs text-gray-400">
              Enable USB Debugging on your Android phone and plug it in via USB (or authorize ADB over Wi-Fi).
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-gray-900/60 border border-gray-800 space-y-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center text-sm">
              3
            </div>
            <h4 className="font-bold text-sm text-gray-200">Instant Cloud Mirroring</h4>
            <p className="text-xs text-gray-400">
              Your device automatically appears in your private dashboard ready for remote control and live streaming!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
