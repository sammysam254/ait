import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Server,
  Smartphone,
  Users,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Building,
  CreditCard,
  Edit3,
  DollarSign,
  PlusCircle,
  MinusCircle,
  X,
  Clock,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export const AdminPortalPage: React.FC = () => {
  const { user } = useAuth();
  const [overview, setOverview] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Pricing & Plan Modal State
  const [selectedOrg, setSelectedOrg] = useState<any | null>(null);
  const [editPlan, setEditPlan] = useState<'starter' | 'enterprise' | 'custom'>('starter');
  const [editStatus, setEditStatus] = useState<'active' | 'trial_active' | 'expired'>('active');
  const [starterPrice, setStarterPrice] = useState<number>(80);
  const [enterprisePrice, setEnterprisePrice] = useState<number>(100);
  const [priceAdjustment, setPriceAdjustment] = useState<number>(0);
  const [pricingNote, setPricingNote] = useState<string>('');
  const [maxDevices, setMaxDevices] = useState<number>(15);
  const [maxAgents, setMaxAgents] = useState<number>(2);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isSuperAdmin = user?.email?.toLowerCase().trim() === 'sammyseth260@gmail.com';

  useEffect(() => {
    if (isSuperAdmin) {
      loadAdminData();
    }
  }, [user]);

  if (!isSuperAdmin) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-center p-8 space-y-4">
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2" />
          <h2 className="text-base font-bold text-white">Access Denied</h2>
          <p className="text-xs text-gray-400 mt-1">Platform Super Admin clearance is required to view this portal.</p>
        </div>
      </div>
    );
  }

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [oRes, cRes] = await Promise.all([
        ApiService.getAdminOverview(),
        ApiService.getAdminCustomers(),
      ]);
      setOverview(oRes);
      setCustomers(cRes.customers || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPricingModal = (c: any) => {
    setSelectedOrg(c);
    setEditPlan(c.plan || 'starter');
    setEditStatus(c.subscriptionStatus || 'active');
    setStarterPrice(c.starterPrice ?? 80);
    setEnterprisePrice(c.enterprisePrice ?? 100);
    setPriceAdjustment(c.priceAdjustmentUsd ?? 0);
    setPricingNote(c.pricingNote || '');
    setMaxDevices(c.maxDevices || (c.plan === 'starter' ? 15 : c.plan === 'enterprise' ? 30 : 100));
    setMaxAgents(c.maxAgents || (c.plan === 'starter' ? 2 : c.plan === 'enterprise' ? 3 : 10));
    setDurationDays(30);
    setFeedback(null);
  };

  const handleSavePricingAndPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg) return;

    setSaving(true);
    setFeedback(null);

    try {
      const res = await ApiService.adminSetSubscription({
        organizationId: selectedOrg.id,
        plan: editPlan,
        subscriptionStatus: editStatus,
        maxDevices: Number(maxDevices),
        maxAgents: Number(maxAgents),
        durationDays: Number(durationDays),
        customPricing: {
          starter: Number(starterPrice),
          enterprise: Number(enterprisePrice),
        },
        priceAdjustmentUsd: Number(priceAdjustment),
        pricingNote: pricingNote.trim(),
      });

      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Successfully updated pricing and plan for ${selectedOrg.name}!`,
        });
        await loadAdminData();
        setTimeout(() => {
          setSelectedOrg(null);
          setFeedback(null);
        }, 1200);
      } else {
        setFeedback({ type: 'error', message: res.message || 'Failed to update.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Save request failed.' });
    } finally {
      setSaving(false);
    }
  };

  const metrics = overview?.metrics;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-semibold mb-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Super Admin Clearance</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Platform Global Administration</h1>
          <p className="text-xs md:text-sm text-gray-400">
            System health, multi-tenant organizations, plan management, and custom pricing controls (add / minus USD)
          </p>
        </div>

        <button
          onClick={loadAdminData}
          className="p-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700"
          title="Refresh Global Data"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Admin Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-1">
          <div className="text-xs text-gray-400 uppercase font-semibold">Total Organizations</div>
          <div className="text-2xl font-bold text-white">{metrics?.totalOrganizations ?? 0}</div>
          <div className="text-[11px] text-gray-500">{metrics?.totalCustomers ?? 0} customer owners</div>
        </div>

        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-1">
          <div className="text-xs text-gray-400 uppercase font-semibold">Total Devices</div>
          <div className="text-2xl font-bold text-white">{metrics?.totalDevices ?? 0}</div>
          <div className="text-[11px] text-emerald-400">{metrics?.onlineDevices ?? 0} online across all tenants</div>
        </div>

        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-1">
          <div className="text-xs text-gray-400 uppercase font-semibold">Active Windows Hosts</div>
          <div className="text-2xl font-bold text-white">{metrics?.onlineAgents ?? 0} / {metrics?.totalAgents ?? 0}</div>
          <div className="text-[11px] text-cyan-400">Global scrcpy agents</div>
        </div>

        <div className="p-5 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-1">
          <div className="text-xs text-gray-400 uppercase font-semibold">System Health</div>
          <div className="text-2xl font-bold text-emerald-400">100%</div>
          <div className="text-[11px] text-gray-400">WebRTC, API, DB Operational</div>
        </div>
      </div>

      {/* Customers & Pricing Table */}
      <div className="rounded-2xl bg-gray-900/70 border border-gray-800 overflow-hidden shadow-xl space-y-4">
        <div className="p-5 pb-0 flex items-center justify-between">
          <h3 className="font-bold text-base text-white flex items-center gap-2">
            <Building className="h-5 w-5 text-indigo-400" />
            <span>Customer Accounts & Pricing Controls</span>
          </h3>
          <span className="text-xs text-gray-500 font-medium">{customers.length} tenant(s)</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[750px]">
            <thead className="bg-gray-950/70 text-gray-400 uppercase tracking-wider text-[10px] border-y border-gray-800">
              <tr>
                <th className="p-4">Customer Organization</th>
                <th className="p-4">Owner Email</th>
                <th className="p-4">Active Plan & Status</th>
                <th className="p-4">Current Pricing (Starter / Ent)</th>
                <th className="p-4">Fleet / Hosts</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-gray-300">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-gray-800/40 transition">
                  <td className="p-4">
                    <div className="font-bold text-gray-100">{c.name}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{c.id}</div>
                  </td>
                  <td className="p-4 text-gray-300 font-mono text-[11px]">
                    {c.ownerEmail}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                        {c.plan} ({c.maxDevices} dev / {c.maxAgents} hosts)
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          c.subscriptionStatus === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : c.subscriptionStatus === 'trial_active'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {c.subscriptionStatus || 'expired'}
                      </span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="space-y-0.5 font-medium">
                      <div className="text-white">
                        Starter: <span className="text-emerald-400 font-bold">${c.starterPrice ?? 80}</span> / mo
                      </div>
                      <div className="text-gray-400">
                        Enterprise: <span className="text-emerald-400 font-bold">${c.enterprisePrice ?? 100}</span> / mo
                      </div>
                      {c.priceAdjustmentUsd !== 0 && (
                        <div className="text-[10px] text-amber-400">
                          Adjustment: {c.priceAdjustmentUsd > 0 ? `+$${c.priceAdjustmentUsd}` : `-$${Math.abs(c.priceAdjustmentUsd)}`}
                        </div>
                      )}
                      {c.pricingNote && (
                        <div className="text-[10px] text-gray-400 italic truncate max-w-xs">{c.pricingNote}</div>
                      )}
                    </div>
                  </td>
                  <td className="p-4 font-semibold text-gray-300">
                    <div><span className="text-emerald-400">{c.deviceCount}</span> phones</div>
                    <div className="text-gray-500 text-[11px]">{c.agentCount} host rig(s) • {c.assignedUsersCount} workers</div>
                  </td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => handleOpenPricingModal(c)}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 hover:text-white border border-indigo-500/30 font-semibold text-xs transition inline-flex items-center gap-1.5"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>Adjust Pricing</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Pricing & Subscription Modal */}
      {selectedOrg && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-xl w-full rounded-3xl bg-gray-900 border border-gray-800 p-6 space-y-6 shadow-2xl relative my-8">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-emerald-400" />
                  <h3 className="text-lg font-bold text-white tracking-tight">
                    Update Pricing & Quotas
                  </h3>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Adjust custom pricing (+ / - USD) and concurrency limits for <span className="text-indigo-400 font-semibold">{selectedOrg.name}</span> ({selectedOrg.ownerEmail})
                </p>
              </div>
              <button
                onClick={() => setSelectedOrg(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {feedback && (
              <div
                className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                  feedback.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                }`}
              >
                {feedback.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                <span>{feedback.message}</span>
              </div>
            )}

            <form onSubmit={handleSavePricingAndPlan} className="space-y-4">
              {/* Plan Selection */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-300 text-xs font-semibold block mb-1">
                    Subscription Plan
                  </label>
                  <select
                    value={editPlan}
                    onChange={(e) => {
                      const newP = e.target.value as any;
                      setEditPlan(newP);
                      if (newP === 'starter') {
                        setMaxDevices(15);
                        setMaxAgents(2);
                      } else if (newP === 'enterprise') {
                        setMaxDevices(30);
                        setMaxAgents(3);
                      } else {
                        setMaxDevices(50);
                        setMaxAgents(5);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-white text-xs focus:outline-none focus:border-indigo-500"
                  >
                    <option value="starter">Starter Plan (Default $80)</option>
                    <option value="enterprise">Enterprise Plan (Default $100)</option>
                    <option value="custom">Custom Fleet Plan</option>
                  </select>
                </div>

                <div>
                  <label className="text-gray-300 text-xs font-semibold block mb-1">
                    Subscription Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-white text-xs focus:outline-none focus:border-indigo-500"
                  >
                    <option value="active">Active (Streams Unlocked)</option>
                    <option value="trial_active">5-Day Trial Active</option>
                    <option value="expired">Expired (Streams Suspended)</option>
                  </select>
                </div>
              </div>

              {/* Specific Pricing Overrides */}
              <div className="p-4 rounded-2xl bg-gray-950/80 border border-gray-800 space-y-3">
                <div className="text-xs font-bold text-gray-200 flex items-center justify-between">
                  <span>Custom Plan Pricing (USD)</span>
                  <span className="text-[11px] text-gray-500 font-normal">Overwrites standard Paystack charges</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-gray-400 text-[11px] block mb-1">
                      Starter Plan Price ($)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500 text-xs">$</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={starterPrice}
                        onChange={(e) => setStarterPrice(Number(e.target.value))}
                        className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-white text-xs font-semibold focus:outline-none focus:border-indigo-500"
                        placeholder="80"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-gray-400 text-[11px] block mb-1">
                      Enterprise Plan Price ($)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500 text-xs">$</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={enterprisePrice}
                        onChange={(e) => setEnterprisePrice(Number(e.target.value))}
                        className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-white text-xs font-semibold focus:outline-none focus:border-indigo-500"
                        placeholder="100"
                      />
                    </div>
                  </div>
                </div>

                {/* Add / Minus General Adjustment */}
                <div>
                  <label className="text-gray-400 text-[11px] block mb-1">
                    Quick Add or Minus Adjustment (+/- USD across plans)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="1"
                      value={priceAdjustment}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setPriceAdjustment(val);
                      }}
                      className="w-32 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-white text-xs font-semibold focus:outline-none focus:border-indigo-500"
                      placeholder="0 (e.g. -15 or +20)"
                    />
                    <div className="flex gap-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setPriceAdjustment(prev => prev - 10);
                          setStarterPrice(p => Math.max(0, p - 10));
                          setEnterprisePrice(p => Math.max(0, p - 10));
                        }}
                        className="px-2 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[11px] font-bold"
                      >
                        -$10 Off
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPriceAdjustment(prev => prev - 20);
                          setStarterPrice(p => Math.max(0, p - 20));
                          setEnterprisePrice(p => Math.max(0, p - 20));
                        }}
                        className="px-2 py-1 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[11px] font-bold"
                      >
                        -$20 Off
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPriceAdjustment(prev => prev + 15);
                          setStarterPrice(p => p + 15);
                          setEnterprisePrice(p => p + 15);
                        }}
                        className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-bold"
                      >
                        +$15 Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPriceAdjustment(0);
                          setStarterPrice(80);
                          setEnterprisePrice(100);
                        }}
                        className="px-2 py-1 rounded bg-gray-800 text-gray-400 text-[11px]"
                      >
                        Reset Defaults
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-gray-400 text-[11px] block mb-1">
                    Special Note / Discount Reason (Shown to customer)
                  </label>
                  <input
                    type="text"
                    value={pricingNote}
                    onChange={(e) => setPricingNote(e.target.value)}
                    placeholder="e.g. Special loyalty discount or custom rig rate"
                    className="w-full px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-200 text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Quotas & Duration */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-gray-400 text-[11px] block mb-1">
                    Max Devices
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={maxDevices}
                    onChange={(e) => setMaxDevices(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-white text-xs font-semibold focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-gray-400 text-[11px] block mb-1">
                    Max Windows Hosts
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={maxAgents}
                    onChange={(e) => setMaxAgents(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-white text-xs font-semibold focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-gray-400 text-[11px] block mb-1">
                    Duration (Days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={durationDays}
                    onChange={(e) => setDurationDays(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg bg-gray-950 border border-gray-800 text-white text-xs font-semibold focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Paystack Charge Preview */}
              <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs flex items-center justify-between">
                <span className="text-gray-400">Effective Paystack Charge:</span>
                <span className="font-bold text-white">
                  Starter: <span className="text-emerald-400">${starterPrice}</span> • Enterprise: <span className="text-emerald-400">${enterprisePrice}</span>
                </span>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedOrg(null)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2"
                >
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  <span>Save Plan & Pricing Override</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default AdminPortalPage;
