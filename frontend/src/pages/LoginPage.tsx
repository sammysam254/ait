import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Smartphone, Lock, Mail, Eye, EyeOff, ShieldCheck, Globe, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ApiService } from '../services/api';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<{ name: string; domain: string } | null>(null);
  const [isInactiveDomain, setIsInactiveDomain] = useState(false);
  const [inactiveHost, setInactiveHost] = useState('');

  // Mandatory Subdomain states for non-admin customers accessing vertext.online
  const [showSubdomainSetupModal, setShowSubdomainSetupModal] = useState(false);
  const [subdomainRedirecting, setSubdomainRedirecting] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState('');
  const [newSubdomainPrefix, setNewSubdomainPrefix] = useState('');
  const [settingUpSubdomain, setSettingUpSubdomain] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    ApiService.resolveDomainTenant()
      .then(res => {
        if (res.matched && res.organization) {
          setTenant({
            name: res.organization.name,
            domain: res.domain || window.location.hostname,
          });
        } else if (!res.isDefaultHost && !res.matched) {
          // Custom subdomain or domain was deleted or unassigned
          setIsInactiveDomain(true);
          setInactiveHost(res.domain || window.location.hostname);
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);
    try {
      const res = await login(email, password);
      if (res?.requiresSubdomainRedirect && res.redirectUrl) {
        setSubdomainRedirecting(res.subdomain || res.redirectUrl);
        window.location.href = `${res.redirectUrl}/dashboard?auth_token=${encodeURIComponent(res.token)}`;
        return;
      }
      if (res?.requiresSubdomainSetup) {
        setSetupToken(res.token);
        setShowSubdomainSetupModal(true);
        return;
      }
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleActivateMandatorySubdomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSlug = newSubdomainPrefix.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    if (!cleanSlug || cleanSlug.length < 2) {
      setSetupError('Subdomain must be at least 2 alphanumeric characters.');
      return;
    }
    setSettingUpSubdomain(true);
    setSetupError(null);
    try {
      await ApiService.provisionSubdomain(cleanSlug);
      setSubdomainRedirecting(`${cleanSlug}.vertext.online`);
      window.location.href = `https://${cleanSlug}.vertext.online/dashboard?auth_token=${encodeURIComponent(setupToken)}`;
    } catch (err: any) {
      setSetupError(err.message || 'Failed to provision subdomain. Please choose a different prefix.');
      setSettingUpSubdomain(false);
    }
  };

  if (subdomainRedirecting) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4">
        <div className="max-w-md w-full rounded-3xl bg-gray-900 border border-indigo-500/40 p-8 shadow-2xl text-center space-y-5 animate-in fade-in duration-200">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white tracking-tight">
              Redirecting to Organization Portal
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed">
              Root domain <span className="text-gray-300 font-mono font-bold">vertext.online</span> is reserved for Super Admin. Transferring your session to:
            </p>
            <div className="p-3 rounded-xl bg-gray-950 border border-indigo-500/30 text-indigo-300 font-mono text-sm font-bold">
              {subdomainRedirecting}
            </div>
          </div>
          <p className="text-[11px] text-gray-500">
            Please wait a moment while your authenticated session is initialized...
          </p>
        </div>
      </div>
    );
  }

  if (isInactiveDomain) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4">
        <div className="max-w-md w-full rounded-3xl bg-gray-900 border border-red-500/30 p-8 shadow-2xl text-center space-y-5 animate-in fade-in duration-200">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
            <Lock className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white tracking-tight">
              Subdomain Inaccessible or Deleted
            </h2>
            <p className="text-xs text-gray-400 leading-relaxed">
              The portal <span className="text-gray-200 font-mono font-bold">{inactiveHost}</span> has been removed or is no longer linked to an active organization.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-gray-950 border border-gray-800 text-[11px] text-gray-400 leading-relaxed">
            If you are the team administrator, log in to the main Vertex portal to manage or re-link your custom domains.
          </div>
          <div className="pt-2">
            <a
              href="https://vertext.online"
              className="inline-flex items-center justify-center w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95"
            >
              Return to Main Portal (vertext.online)
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-400 flex items-center justify-center mx-auto shadow-xl shadow-indigo-600/30">
            <Smartphone className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {tenant ? tenant.name : 'Vertex Cloud Device Farm'}
          </h1>
          <p className="text-xs text-gray-400">
            {tenant ? `Private Device Access Gateway • ${tenant.domain}` : 'Enterprise scrcpy 3.3.4 Multi-Tenant SaaS Platform'}
          </p>
          {tenant && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[11px] font-medium">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Verified Organization Portal
            </div>
          )}
        </div>

        {/* Form Card */}
        <div className="rounded-3xl bg-gray-900 border border-gray-800 p-8 shadow-2xl space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs leading-relaxed">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-gray-300 font-semibold block">Email Address</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500 text-xs"
                />
                <Mail className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-gray-300 font-semibold block">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500 text-xs"
                />
                <Lock className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : `Sign In to ${tenant ? tenant.name : 'Dashboard'}`}
            </button>
          </form>
        </div>

        <div className="text-center text-xs text-gray-500">
          {tenant ? (
            <span>
              Invited worker? Sign in with the email address your invitation was sent to.
            </span>
          ) : (
            <span>
              Don't have an account?{' '}
              <Link to="/register" className="text-indigo-400 hover:text-indigo-300 font-semibold">
                Create Customer Account
              </Link>
            </span>
          )}
        </div>
      </div>

      {/* Mandatory Subdomain Provisioning Modal for vertext.online */}
      {showSubdomainSetupModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="max-w-md w-full rounded-3xl bg-gray-900 border border-indigo-500/40 p-7 shadow-2xl space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Globe className="h-7 w-7" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xl font-extrabold text-white tracking-tight">
                Setup Mandatory Subdomain
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                The root domain <span className="font-mono text-gray-200 font-bold">vertext.online</span> is strictly reserved for Super Admin. Please create your organization's dedicated subdomain gateway.
              </p>
            </div>

            {setupError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {setupError}
              </div>
            )}

            <form onSubmit={handleActivateMandatorySubdomain} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-300">
                  Choose Your Subdomain Prefix
                </label>
                <div className="flex items-center rounded-xl bg-gray-950 border border-gray-800 focus-within:border-indigo-500 overflow-hidden">
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="mybrand"
                    value={newSubdomainPrefix}
                    onChange={(e) => setNewSubdomainPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    className="w-full px-3 py-2.5 bg-transparent text-gray-100 placeholder-gray-600 text-xs focus:outline-none"
                  />
                  <span className="px-3 py-2.5 bg-gray-900/60 border-l border-gray-800 text-gray-400 font-mono text-xs select-none">
                    .vertext.online
                  </span>
                </div>
                <p className="text-[11px] text-gray-500">
                  Your team and workers will access your device dashboard at this custom portal address.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={settingUpSubdomain || !newSubdomainPrefix.trim()}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {settingUpSubdomain ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Provisioning Cloudflare DNS & SSL...</span>
                    </>
                  ) : (
                    <>
                      <span>Activate & Enter Dashboard</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
