import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  User,
  Globe,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Search,
  ShoppingCart,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  Server,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ApiService } from '../services/api';

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const isWorker = user?.role === 'assigned_user';

  // Tab: 'domains' | 'profile' | 'security'
  const [activeTab, setActiveTab] = useState<'domains' | 'profile' | 'security'>(
    user?.role === 'assigned_user' ? 'profile' : 'domains'
  );

  // Domains State
  const [domains, setDomains] = useState<any[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [domainActionError, setDomainActionError] = useState<string | null>(null);
  const [domainActionSuccess, setDomainActionSuccess] = useState<string | null>(null);

  // Cloudflare Search / Connect State
  const [cfQuery, setCfQuery] = useState('');
  const [cfZones, setCfZones] = useState<any[]>([]);
  const [searchingCf, setSearchingCf] = useState(false);
  const [selectedZone, setSelectedZone] = useState<any | null>(null);
  const [cfSubdomainPrefix, setCfSubdomainPrefix] = useState('app');
  const [connectingCf, setConnectingCf] = useState(false);
  // Custom CF token (for customers with their own CF account)
  const [useOwnCf, setUseOwnCf] = useState(false);
  const [customCfToken, setCustomCfToken] = useState('');

  // Buy Domain State
  const [buyDomainName, setBuyDomainName] = useState('');
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [buyAvailability, setBuyAvailability] = useState<{ available: boolean; price?: number; redirectUrl?: string } | null>(null);
  const [buyingDomain, setBuyingDomain] = useState(false);

  // Free Subdomain State
  const [subdomainPrefix, setSubdomainPrefix] = useState('');
  const [provisioningSubdomain, setProvisioningSubdomain] = useState(false);

  // External Domain State
  const [externalDomainName, setExternalDomainName] = useState('');
  const [addingExternal, setAddingExternal] = useState(false);
  const [externalInstructions, setExternalInstructions] = useState<any | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [copiedTxt, setCopiedTxt] = useState(false);

  const fetchDomains = async () => {
    setLoadingDomains(true);
    try {
      const res = await ApiService.getDomains();
      setDomains(res.domains || []);
    } catch (e: any) {
      console.error('Failed to load domains', e);
    } finally {
      setLoadingDomains(false);
    }
  };

  useEffect(() => {
    fetchDomains();
  }, []);

  // Search Cloudflare Zones
  const handleSearchCloudflare = async () => {
    setSearchingCf(true);
    setDomainActionError(null);
    try {
      const token = useOwnCf ? customCfToken.trim() : undefined;
      const res = await ApiService.searchCloudflareZones(cfQuery, token);
      setCfZones(res.zones || []);
      if ((res.zones || []).length === 0) {
        setDomainActionError(`No Cloudflare zones found matching "${cfQuery}".`);
      }
    } catch (e: any) {
      setDomainActionError(e.message || 'Failed to search Cloudflare domains');
    } finally {
      setSearchingCf(false);
    }
  };

  // Connect Cloudflare Zone Domain
  const handleConnectCloudflare = async (zone: any) => {
    setConnectingCf(true);
    setDomainActionError(null);
    setDomainActionSuccess(null);

    const fullDomain = cfSubdomainPrefix ? `${cfSubdomainPrefix}.${zone.name}` : zone.name;
    const token = useOwnCf ? customCfToken.trim() : undefined;

    try {
      const res = await ApiService.connectCloudflareDomain(fullDomain, zone.id, token);
      setDomainActionSuccess(res.message || `Successfully linked ${fullDomain}!`);
      setSelectedZone(null);
      setCfQuery('');
      setCfZones([]);
      await fetchDomains();
    } catch (e: any) {
      setDomainActionError(e.message || 'Failed to link Cloudflare domain');
    } finally {
      setConnectingCf(false);
    }
  };

  // Provision Free Subdomain
  const handleProvisionSubdomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subdomainPrefix.trim()) return;

    setProvisioningSubdomain(true);
    setDomainActionError(null);
    setDomainActionSuccess(null);

    try {
      const res = await ApiService.provisionSubdomain(subdomainPrefix.trim());
      setDomainActionSuccess(res.message || 'Subdomain activated!');
      setSubdomainPrefix('');
      await fetchDomains();
    } catch (e: any) {
      setDomainActionError(e.message || 'Failed to provision subdomain');
    } finally {
      setProvisioningSubdomain(false);
    }
  };

  // Check Domain Availability & redirect to Cloudflare
  const handleCheckAndBuyDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyDomainName.trim()) return;

    setCheckingAvailability(true);
    setBuyAvailability(null);
    setDomainActionError(null);

    try {
      const res = await ApiService.checkDomainAvailability(buyDomainName.trim());
      setBuyAvailability(res);
    } catch (e: any) {
      setDomainActionError(e.message || 'Failed to check domain availability');
    } finally {
      setCheckingAvailability(false);
    }
  };

  const handleBuyDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyDomainName.trim()) return;

    setBuyingDomain(true);
    setDomainActionError(null);
    setDomainActionSuccess(null);

    try {
      const res = await ApiService.buyDomain(buyDomainName.trim(), 1);
      if (res.redirectUrl) {
        window.open(res.redirectUrl, '_blank', 'noopener,noreferrer');
        setDomainActionSuccess(res.message || 'Opening Cloudflare to complete your purchase...');
      } else {
        setDomainActionSuccess(res.message || `Domain ${buyDomainName} registered!`);
        setBuyDomainName('');
        await fetchDomains();
      }
    } catch (e: any) {
      setDomainActionError(e.message || 'Failed to purchase domain');
    } finally {
      setBuyingDomain(false);
    }
  };

  // Add External Domain
  const handleAddExternal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!externalDomainName.trim()) return;

    setAddingExternal(true);
    setDomainActionError(null);
    setDomainActionSuccess(null);

    try {
      const res = await ApiService.addExternalDomain(externalDomainName.trim());
      setExternalInstructions(res);
      setExternalDomainName('');
      await fetchDomains();
    } catch (e: any) {
      setDomainActionError(e.message || 'Failed to add external domain');
    } finally {
      setAddingExternal(false);
    }
  };

  // Verify External Domain
  const handleVerifyExternal = async (domainId: string) => {
    setVerifyingId(domainId);
    setDomainActionError(null);
    setDomainActionSuccess(null);

    try {
      const res = await ApiService.verifyExternalDomain(domainId);
      if (res.success) {
        setDomainActionSuccess('Domain verified and active!');
        setExternalInstructions(null);
        await fetchDomains();
      }
    } catch (e: any) {
      setDomainActionError(e.message || 'Verification failed. Please check your DNS records.');
    } finally {
      setVerifyingId(null);
    }
  };

  // Remove Domain
  const handleRemoveDomain = async (domainId: string) => {
    if (!window.confirm('Are you sure you want to disconnect this domain from your dashboard?')) return;

    setDomainActionError(null);
    setDomainActionSuccess(null);
    try {
      await ApiService.removeDomain(domainId);
      setDomainActionSuccess('Domain removed successfully.');
      await fetchDomains();
    } catch (e: any) {
      setDomainActionError(e.message || 'Failed to remove domain');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTxt(true);
    setTimeout(() => setCopiedTxt(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Organization & Domain Settings</h1>
        <p className="text-xs md:text-sm text-gray-400">
          Link custom domains, automate Cloudflare DNS, configure team isolation, and manage credentials
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 space-x-2">
        {!isWorker && (
          <button
            onClick={() => setActiveTab('domains')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl transition ${
              activeTab === 'domains'
                ? 'bg-gray-900 border-t border-x border-gray-800 text-indigo-400 shadow'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Globe className="h-4 w-4" />
            <span>Custom Domains & Dashboard URLs</span>
            {domains.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">
                {domains.length}
              </span>
            )}
          </button>
        )}

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl transition ${
            activeTab === 'profile'
              ? 'bg-gray-900 border-t border-x border-gray-800 text-indigo-400 shadow'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <User className="h-4 w-4" />
          <span>Profile & Organization</span>
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl transition ${
            activeTab === 'security'
              ? 'bg-gray-900 border-t border-x border-gray-800 text-indigo-400 shadow'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Shield className="h-4 w-4" />
          <span>Security & Isolation</span>
        </button>
      </div>

      {/* Global Alerts */}
      {domainActionError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{domainActionError}</span>
        </div>
      )}

      {domainActionSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{domainActionSuccess}</span>
        </div>
      )}

      {/* TAB 1: CUSTOM DOMAINS */}
      {activeTab === 'domains' && (
        <div className="space-y-6">
          {/* Active Domains Table */}
          <div className="rounded-2xl bg-gray-900/80 border border-gray-800 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Globe className="h-4 w-4 text-indigo-400" />
                  <span>Linked Dashboard Domains</span>
                </h3>
                <p className="text-xs text-gray-400">
                  Workers and clients visiting these domains will automatically see your branded login portal.
                </p>
              </div>
              <button
                onClick={fetchDomains}
                disabled={loadingDomains}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs flex items-center gap-1.5 transition"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingDomains ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {loadingDomains ? (
              <div className="p-6 text-center text-xs text-gray-500">Loading domains...</div>
            ) : domains.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-gray-800 rounded-xl space-y-2">
                <Globe className="h-8 w-8 text-gray-600 mx-auto" />
                <p className="text-xs text-gray-300 font-semibold">No custom domains connected yet</p>
                <p className="text-[11px] text-gray-500 max-w-sm mx-auto">
                  Connect a domain from your Cloudflare account, register a new one, or create a free custom subdomain below.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {domains.map((d) => (
                  <div
                    key={d.id}
                    className="p-4 rounded-xl bg-gray-950 border border-gray-800 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm">{d.domain}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            d.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {d.status === 'active' ? '● Active & Live' : '○ Pending Verification'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px]">
                          {d.domain_type === 'subdomain' ? 'Subdomain' : 'Custom Domain'}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400">
                        Target: <span className="font-mono text-gray-300">app.vertext.online</span> • Added on{' '}
                        {new Date(d.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {d.status === 'pending_verification' && (
                        <button
                          onClick={() => handleVerifyExternal(d.id)}
                          disabled={verifyingId === d.id}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition"
                        >
                          <RefreshCw className={`h-3 w-3 ${verifyingId === d.id ? 'animate-spin' : ''}`} />
                          <span>Verify DNS</span>
                        </button>
                      )}

                      <a
                        href={`https://${d.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Visit Dashboard</span>
                      </a>

                      <button
                        onClick={() => handleRemoveDomain(d.id)}
                        className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs transition"
                        title="Disconnect Domain"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* External Domain Setup Instructions Box if generated */}
          {externalInstructions && (
            <div className="p-5 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 text-xs space-y-3">
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-sm">
                <Server className="h-4 w-4" />
                <span>DNS Configuration Required for {externalInstructions.domain}</span>
              </div>
              <p className="text-gray-300 text-[11px]">
                Log in to your domain registrar (GoDaddy, Namecheap, Route53, etc.) and add the following two DNS records:
              </p>
              <div className="space-y-2 font-mono text-[11px]">
                <div className="p-2.5 rounded-lg bg-gray-950 border border-gray-800 flex items-center justify-between">
                  <div>
                    <span className="text-gray-500">Record 1: </span>
                    <span className="text-amber-400 font-bold">CNAME</span> | Host:{' '}
                    <span className="text-gray-200">@ or {externalInstructions.domain}</span> → Value:{' '}
                    <span className="text-emerald-400">{externalInstructions.cname_target}</span>
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-gray-950 border border-gray-800 flex items-center justify-between">
                  <div>
                    <span className="text-gray-500">Record 2: </span>
                    <span className="text-cyan-400 font-bold">TXT</span> | Host:{' '}
                    <span className="text-gray-200">{externalInstructions.txt_name}</span> → Value:{' '}
                    <span className="text-cyan-300">{externalInstructions.txt_value}</span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(externalInstructions.txt_value)}
                    className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center gap-1 text-[10px]"
                  >
                    {copiedTxt ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedTxt ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Domain Connection Methods */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* METHOD 1: Cloudflare Auto-Configure (One-Click) */}
            <div className="rounded-2xl bg-gray-900/80 border border-gray-800 p-6 space-y-4 shadow-xl">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                    RECOMMENDED
                  </span>
                  <h4 className="text-sm font-bold text-white">Cloudflare Auto-Connect</h4>
                </div>
                <p className="text-[11px] text-gray-400">
                  Search domains already in your Cloudflare account. The system will automatically create the DNS CNAME record
                  instantly!
                </p>
              </div>

              {/* Optional: use own CF account */}
              <div className="p-3 rounded-xl bg-gray-950 border border-gray-800 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={useOwnCf}
                    onChange={(e) => { setUseOwnCf(e.target.checked); setCfZones([]); }}
                    className="accent-amber-500 w-3.5 h-3.5"
                  />
                  <span className="font-semibold">I have my own Cloudflare account</span>
                </label>
                {useOwnCf && (
                  <div className="space-y-1.5 pl-5">
                    <input
                      type="password"
                      placeholder="Paste your Cloudflare API Token here"
                      value={customCfToken}
                      onChange={(e) => setCustomCfToken(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-xs focus:outline-none focus:border-amber-500 font-mono"
                    />
                    <p className="text-[10px] text-gray-500">
                      Get token at <span className="text-amber-400">dash.cloudflare.com → My Profile → API Tokens</span>.
                      Required permissions: <span className="font-mono text-gray-300">Zone:Read</span> + <span className="font-mono text-gray-300">Zone DNS:Edit</span>
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Search e.g. mycompany.com"
                    value={cfQuery}
                    onChange={(e) => setCfQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchCloudflare()}
                    className="w-full pl-8 pr-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-white text-xs focus:outline-none focus:border-amber-500"
                  />
                  <Search className="h-3.5 w-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                </div>
                <button
                  onClick={handleSearchCloudflare}
                  disabled={searchingCf || (useOwnCf && !customCfToken.trim())}
                  className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition disabled:opacity-50"
                >
                  {searchingCf ? 'Searching...' : 'Search'}
                </button>
              </div>

              {/* Cloudflare Zone Results */}
              {cfZones.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {cfZones.map((z) => (
                    <div
                      key={z.id}
                      className="p-3 rounded-xl bg-gray-950 border border-gray-800 flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-bold text-white">{z.name}</p>
                        <p className="text-[10px] text-gray-400">Status: {z.status}</p>
                      </div>

                      {selectedZone?.id === z.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="subdomain (e.g. app)"
                            value={cfSubdomainPrefix}
                            onChange={(e) => setCfSubdomainPrefix(e.target.value)}
                            className="w-20 px-2 py-1 rounded bg-gray-900 border border-gray-700 text-white text-[11px]"
                          />
                          <button
                            onClick={() => handleConnectCloudflare(z)}
                            disabled={connectingCf}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition"
                          >
                            {connectingCf ? 'Linking...' : 'Confirm'}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setSelectedZone(z);
                            setCfSubdomainPrefix('app');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-semibold text-[11px] transition"
                        >
                          Add domain for my dashboard
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* METHOD 2: Free *.vertext.online Subdomain */}
            <div className="rounded-2xl bg-gray-900/80 border border-gray-800 p-6 space-y-4 shadow-xl">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                    100% FREE & INSTANT
                  </span>
                  <h4 className="text-sm font-bold text-white">Create Custom Subdomain</h4>
                </div>
                <p className="text-[11px] text-gray-400">
                  Instant branded gateway on our root domain with automated SSL.
                </p>
              </div>

              <form onSubmit={handleProvisionSubdomain} className="space-y-3">
                <div className="flex items-center rounded-xl bg-gray-950 border border-gray-800 overflow-hidden px-3 py-1.5 focus-within:border-emerald-500">
                  <input
                    type="text"
                    required
                    placeholder="myteam"
                    value={subdomainPrefix}
                    onChange={(e) => setSubdomainPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    className="w-full bg-transparent text-white text-xs focus:outline-none"
                  />
                  <span className="text-gray-500 text-xs font-mono">.vertext.online</span>
                </div>

                <button
                  type="submit"
                  disabled={provisioningSubdomain || !subdomainPrefix}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
                >
                  {provisioningSubdomain ? 'Activating Subdomain...' : 'Activate Free Subdomain'}
                </button>
              </form>
            </div>

            {/* METHOD 3: Buy New Domain */}
            <div className="rounded-2xl bg-gray-900/80 border border-gray-800 p-6 space-y-4 shadow-xl">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-cyan-400" />
                  <h4 className="text-sm font-bold text-white">Buy & Auto-Link Domain</h4>
                </div>
                <p className="text-[11px] text-gray-400">
                  Check availability and purchase through Cloudflare Registrar. After purchase, Cloudflare automatically routes DNS
                  — then come back and use <span className="text-amber-400 font-semibold">Cloudflare Auto-Connect</span> to link
                  it to your dashboard in one click.
                </p>
              </div>

              <form onSubmit={handleCheckAndBuyDomain} className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="e.g. acmephones.com"
                    value={buyDomainName}
                    onChange={(e) => { setBuyDomainName(e.target.value); setBuyAvailability(null); }}
                    className="flex-1 px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="submit"
                    disabled={checkingAvailability || !buyDomainName}
                    className="px-3 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold text-xs transition disabled:opacity-50"
                  >
                    {checkingAvailability ? 'Checking...' : 'Check'}
                  </button>
                </div>

                {buyAvailability && (
                  <div className={`p-3 rounded-xl border text-xs ${buyAvailability.available ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
                    {buyAvailability.available ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="font-bold">Available!</span>
                          {buyAvailability.price && <span className="text-gray-300">~${buyAvailability.price}/yr via Cloudflare</span>}
                        </div>
                        <button
                          type="button"
                          onClick={handleBuyDomain}
                          disabled={buyingDomain}
                          className="w-full py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>{buyingDomain ? 'Opening Cloudflare...' : 'Buy on Cloudflare Registrar →'}</span>
                        </button>
                        <p className="text-[10px] text-gray-500 text-center">
                          Payment handled securely by Cloudflare. After purchase, return here and use Cloudflare Auto-Connect.
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-3.5 w-3.5" />
                        <span>Domain is not available for registration.</span>
                      </div>
                    )}
                  </div>
                )}
              </form>
            </div>

            {/* METHOD 4: Add External Domain (Third-Party Registrar) */}
            <div className="rounded-2xl bg-gray-900/80 border border-gray-800 p-6 space-y-4 shadow-xl">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-purple-400" />
                  <h4 className="text-sm font-bold text-white">External Domain (GoDaddy, Namecheap)</h4>
                </div>
                <p className="text-[11px] text-gray-400">
                  Connect any domain registered with an external registrar by setting up CNAME and TXT records.
                </p>
              </div>

              <form onSubmit={handleAddExternal} className="space-y-3">
                <input
                  type="text"
                  required
                  placeholder="e.g. portal.myclient.com"
                  value={externalDomainName}
                  onChange={(e) => setExternalDomainName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-white text-xs focus:outline-none focus:border-purple-500"
                />

                <button
                  type="submit"
                  disabled={addingExternal || !externalDomainName}
                  className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/20 transition disabled:opacity-50"
                >
                  {addingExternal ? 'Adding Domain...' : 'Generate DNS Records'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PROFILE */}
      {activeTab === 'profile' && (
        <div className="rounded-2xl bg-gray-900/70 border border-gray-800 p-6 space-y-6 shadow-xl">
          <div className="space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <User className="h-4 w-4 text-indigo-400" />
              <span>Profile Information</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-gray-400 block mb-1 font-semibold">Full Name</label>
                <input
                  type="text"
                  readOnly
                  value={user?.fullName || ''}
                  className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200"
                />
              </div>
              <div>
                <label className="text-gray-400 block mb-1 font-semibold">Email Address</label>
                <input
                  type="email"
                  readOnly
                  value={user?.email || ''}
                  className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200"
                />
              </div>
              <div>
                <label className="text-gray-400 block mb-1 font-semibold">Account Role</label>
                <input
                  type="text"
                  readOnly
                  value={user?.role || ''}
                  className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-200 uppercase font-mono text-[11px]"
                />
              </div>
              <div>
                <label className="text-gray-400 block mb-1 font-semibold">Tenant Organization ID</label>
                <input
                  type="text"
                  readOnly
                  value={user?.organizationId || ''}
                  className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-800 text-gray-400 font-mono text-[11px]"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SECURITY */}
      {activeTab === 'security' && (
        <div className="rounded-2xl bg-gray-900/70 border border-gray-800 p-6 space-y-6 shadow-xl">
          <div className="space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-400" />
              <span>Security & Isolation Status</span>
            </h3>
            <div className="p-4 rounded-xl bg-gray-950 border border-gray-800 text-xs text-gray-400 space-y-3">
              <div className="flex items-center justify-between">
                <span>Domain-Level Tenant Isolation</span>
                <span className="text-emerald-400 font-semibold">Active (Cross-Tenant Restricted)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Worker Domain Boundary Enforcement</span>
                <span className="text-emerald-400 font-semibold">Strict (Only Invited Org Portal Allowed)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Row Level Security (RLS)</span>
                <span className="text-emerald-400 font-semibold">Enforced in Supabase</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Cloudflare Tunnel Zero-Trust</span>
                <span className="text-cyan-400 font-semibold">Active & Encrypted</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Device Sharing PIN Encryption</span>
                <span className="text-emerald-400 font-semibold">bcrypt (10 rounds)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
