import React, { useEffect, useState } from 'react';
import {
  CreditCard,
  Check,
  Shield,
  Zap,
  Clock,
  AlertTriangle,
  Lock,
  Phone,
  MessageCircle,
  CheckCircle2,
  HelpCircle,
  ExternalLink,
  RefreshCw,
  Server,
  Smartphone,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ApiService } from '../services/api';

declare global {
  interface Window {
    PaystackPop?: any;
  }
}

export const SubscriptionPage: React.FC = () => {
  const { user } = useAuth();
  const [subData, setSubData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    loadSubscription();
    loadPaystackScript();
  }, []);

  const loadPaystackScript = () => {
    if (document.getElementById('paystack-inline-js')) return;
    const script = document.createElement('script');
    script.id = 'paystack-inline-js';
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    document.body.appendChild(script);
  };

  const loadSubscription = async () => {
    setLoading(true);
    try {
      const data = await ApiService.getSubscriptionStatus();
      setSubData(data);
    } catch (err: any) {
      console.error('Failed to load subscription:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptTerms = async () => {
    if (!termsAgreed) {
      alert('Please check the confirmation box indicating you have read and accepted all 5 terms.');
      return;
    }
    setActionLoading('terms');
    setFeedback(null);
    try {
      const res = await ApiService.acceptSubscriptionTerms();
      setSubData(res.status);
      setFeedback({ type: 'success', message: 'Subscription terms accepted successfully! Please select your plan.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to accept terms.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartTrial = async () => {
    setActionLoading('trial');
    setFeedback(null);
    try {
      const res = await ApiService.startStarterTrial();
      setSubData(res.status);
      setFeedback({
        type: 'success',
        message: '🎉 5-Day Starter Free Trial activated! Device streams and Windows hosts are now unlocked.',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to activate trial.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handlePaymentSuccess = async (response: any, plan: 'starter' | 'enterprise') => {
    setActionLoading('verifying');
    try {
      // Confirm deposit with backend & verify via Paystack API
      const verifyRes = await ApiService.verifyPaystackPayment(response.reference, plan);
      if (verifyRes.success) {
        setSubData(verifyRes.status);
        setFeedback({
          type: 'success',
          message: `✅ Payment verified successfully! Your ${plan.toUpperCase()} subscription is active. All streams are unlocked.`,
        });
      } else {
        setFeedback({ type: 'error', message: verifyRes.message || 'Payment verification failed.' });
      }
    } catch (vErr: any) {
      setFeedback({ type: 'error', message: vErr.message || 'Failed to verify payment with server.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handlePaystackPayment = async (plan: 'starter' | 'enterprise') => {
    setActionLoading(`pay-${plan}`);
    setFeedback(null);
    try {
      // 1. Initialize Paystack reference from backend
      const initData = await ApiService.initializePaystack(plan);

      // Verify Paystack inline script is available
      if (!window.PaystackPop) {
        throw new Error('Paystack payment gateway is loading. Please retry in 3 seconds.');
      }

      const paystackKey = initData.publicKey || (import.meta.env.VITE_PAYSTACK_PUBLIC_KEY as string) || (typeof atob !== 'undefined' ? atob('cGtfbGl2ZV81NThlMWVkODExNGM2M2MwOWIxMzViMTUyMzQ0M2VjZmZmYjYwNTI0') : '');

      // 2. Open Paystack Inline Checkout Modal inside the web app (never redirecting outside!)
      // Note: callback must be a standard synchronous function reference for Paystack's validation
      const handler = window.PaystackPop.setup({
        key: paystackKey,
        publicKey: paystackKey,
        email: initData.email || user?.email,
        amount: initData.amountCents, // Converted into KES sub-units in code
        currency: initData.currency || 'KES',
        ref: initData.reference,
        metadata: {
          organization_id: subData?.organizationId || user?.organizationId,
          plan: plan,
          custom_fields: [
            { display_name: 'Plan', variable_name: 'plan', value: plan },
            { display_name: 'User', variable_name: 'user_email', value: user?.email },
          ],
        },
        callback: function (response: any) {
          handlePaymentSuccess(response, plan);
        },
        onClose: function () {
          setActionLoading(null);
        },
      });

      handler.openIframe();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Payment initialization failed.' });
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
        <p className="text-gray-400 text-xs">Loading subscription details and quotas...</p>
      </div>
    );
  }

  const termsAccepted = subData?.termsAccepted ?? false;
  const status = subData?.status ?? 'terms_required';
  const isActive = subData?.active ?? false;
  const isSuperAdmin = user?.email === 'sammyseth260@gmail.com';
  const starterPrice = subData?.starterPriceUsd ?? 80;
  const enterprisePrice = subData?.enterprisePriceUsd ?? 100;
  const hasCustomStarter = starterPrice !== 80;
  const hasCustomEnterprise = enterprisePrice !== 100;
  const pricingNote = subData?.pricingNote;

  return (
    <div className="space-y-8 max-w-6xl pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Subscription & Billing Plans</h1>
          <p className="text-xs md:text-sm text-gray-400">
            Select your monthly plan, review terms, and unlock live device streaming
          </p>
        </div>

        {/* Status Pill */}
        <div className="flex items-center gap-2">
          {isActive ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
              <CheckCircle2 className="h-4 w-4" />
              <span>{status === 'trial_active' ? 'Free Trial Active' : 'Active Subscription'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold animate-pulse">
              <AlertTriangle className="h-4 w-4" />
              <span>Streams Suspended (Payment Due)</span>
            </div>
          )}
        </div>
      </div>

      {/* Global Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl border text-xs md:text-sm font-semibold flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-gray-400 hover:text-white text-xs">
            ✕
          </button>
        </div>
      )}

      {/* Current Subscription Status Bar */}
      <div className="p-6 rounded-2xl bg-gray-900/80 border border-gray-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Active Organization</div>
            <div className="text-lg font-bold text-white flex items-center gap-2">
              <span>{subData?.organizationName || user?.organizationId}</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 capitalize">
                {subData?.plan || 'Starter'} Plan
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-xl bg-gray-950/60 border border-gray-800">
              <div className="text-gray-500">Device Quota</div>
              <div className="font-bold text-white flex items-center gap-1.5 mt-0.5">
                <Smartphone className="h-3.5 w-3.5 text-indigo-400" />
                <span>{subData?.maxDevices || 15} Phones</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-gray-950/60 border border-gray-800">
              <div className="text-gray-500">Host Rigs</div>
              <div className="font-bold text-white flex items-center gap-1.5 mt-0.5">
                <Server className="h-3.5 w-3.5 text-indigo-400" />
                <span>{subData?.maxAgents || 2} Computers</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-gray-950/60 border border-gray-800 col-span-2 sm:col-span-1">
              <div className="text-gray-500">Renewal Due Date</div>
              <div className="font-bold text-emerald-400 flex items-center gap-1.5 mt-0.5">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  {subData?.dueDate
                    ? new Date(subData.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Pending Plan'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {!isActive && !isSuperAdmin && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold">Streaming Suspended Until Subscription Paid</div>
              <p className="text-rose-200/80 leading-relaxed">
                Your monthly billing due date has passed. WebRTC device streaming and scrcpy touch control are locked by the server. Pay the monthly fee below to unblock all devices instantly.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* STEP 1: Mandatory Subscription Terms Reader (If terms not yet accepted) */}
      {!termsAccepted && !isSuperAdmin && (
        <div className="p-6 md:p-8 rounded-3xl bg-gradient-to-br from-gray-900 via-indigo-950/20 to-gray-900 border-2 border-indigo-500/40 shadow-2xl space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-white tracking-tight">Step 1: Read & Accept Terms</h2>
              <p className="text-xs text-gray-400">
                All existing and new customers must review and accept the 5 billing conditions prior to plan activation.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(subData?.terms || []).map((term: any) => (
              <div
                key={term.id}
                className="p-4 rounded-2xl bg-gray-950/70 border border-gray-800 space-y-2 hover:border-gray-700 transition"
              >
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
                  <span className="h-5 w-5 rounded-full bg-indigo-500/20 flex items-center justify-center text-[10px]">
                    {term.id}
                  </span>
                  <span>{term.title}</span>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed">{term.content}</p>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <label className="flex items-start sm:items-center gap-3 cursor-pointer group select-none">
              <input
                type="checkbox"
                checked={termsAgreed}
                onChange={(e) => setTermsAgreed(e.target.checked)}
                className="mt-0.5 sm:mt-0 h-4 w-4 rounded border-gray-700 bg-gray-950 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-gray-900"
              />
              <span className="text-xs font-semibold text-gray-300 group-hover:text-white">
                I have read, understood, and agree to all 5 Vertex Cloud Subscription & Suspension Terms.
              </span>
            </label>

            <button
              onClick={handleAcceptTerms}
              disabled={!termsAgreed || actionLoading === 'terms'}
              className="py-3 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95 flex items-center justify-center gap-2"
            >
              {actionLoading === 'terms' ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Recording Acceptance...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>Accept Terms & Unlock Plans</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Subscription Plans Grid (Available after terms accepted) */}
      <div className={`space-y-4 ${!termsAccepted && !isSuperAdmin ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="space-y-1">
          <h2 className="text-xl font-extrabold text-white tracking-tight">Available Subscription Plans</h2>
          <p className="text-xs text-gray-400">
            Pay safely via in-app Paystack checkout. Streaming unlocks immediately upon confirmed deposit.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 1. Starter Plan */}
          <div className="p-6 rounded-3xl bg-gray-900/80 border border-gray-800 flex flex-col justify-between space-y-6 hover:border-gray-700 transition relative">
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Small Fleet</span>
                  {hasCustomStarter && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                      Custom Rate
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-bold text-white">Starter</h3>
                <div className="text-3xl font-extrabold text-white flex items-baseline gap-2">
                  ${starterPrice}<span className="text-xs font-normal text-gray-400"> / month</span>
                  {hasCustomStarter && (
                    <span className="text-xs line-through text-gray-500 font-normal">$80</span>
                  )}
                </div>
                {hasCustomStarter && pricingNote && (
                  <p className="text-[11px] text-amber-400 font-medium">Note: {pricingNote}</p>
                )}
                <p className="text-xs text-gray-400">Supports up to 15 phones across 2 computer hosts</p>
              </div>

              <div className="space-y-2.5 text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Up to 15 Connected Android Phones</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>2 Windows Host Computers</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>60 FPS H.264 Video Streaming</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Interactive Touch & Virtual Controls</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>5-Day Free Trial Option</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              {/* 5-Day Free Trial Option (Only if not used yet) */}
              {!subData?.trialStartedAt && (
                <button
                  onClick={handleStartTrial}
                  disabled={actionLoading !== null}
                  className="w-full py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold border border-gray-700 transition flex items-center justify-center gap-2"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  <span>Start 5-Day Free Trial</span>
                </button>
              )}

              {/* Pay Direct */}
              <button
                onClick={() => handlePaystackPayment('starter')}
                disabled={actionLoading !== null}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition transform active:scale-95 flex items-center justify-center gap-2"
              >
                <CreditCard className="h-4 w-4" />
                <span>
                  {actionLoading === 'pay-starter' ? 'Opening Paystack...' : `Pay $${starterPrice} / mo via Paystack`}
                </span>
              </button>
            </div>
          </div>

          {/* 2. Enterprise Plan */}
          <div className="p-6 rounded-3xl bg-indigo-950/30 border-2 border-indigo-500/60 flex flex-col justify-between space-y-6 relative shadow-2xl">
            <div className="absolute -top-3 right-6 px-3 py-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-[10px] font-bold text-white uppercase tracking-wider shadow-md">
              High Density
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Heavy Testing Rig</span>
                  {hasCustomEnterprise && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                      Custom Rate
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-bold text-white">Enterprise</h3>
                <div className="text-3xl font-extrabold text-white flex items-baseline gap-2">
                  ${enterprisePrice}<span className="text-xs font-normal text-gray-400"> / month</span>
                  {hasCustomEnterprise && (
                    <span className="text-xs line-through text-gray-500 font-normal">$100</span>
                  )}
                </div>
                {hasCustomEnterprise && pricingNote && (
                  <p className="text-[11px] text-amber-400 font-medium">Note: {pricingNote}</p>
                )}
                <p className="text-xs text-gray-400">Supports up to 30 phones across 3 computer hosts</p>
              </div>

              <div className="space-y-2.5 text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Up to 30 Connected Android Phones</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>3 Windows Host Computers</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>60 FPS H.264 Video Streaming</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Subordinate Worker Assignments & PIN</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Dedicated WebRTC Relays & Audit Logs</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button
                onClick={() => handlePaystackPayment('enterprise')}
                disabled={actionLoading !== null}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition transform active:scale-95 flex items-center justify-center gap-2"
              >
                <CreditCard className="h-4 w-4" />
                <span>
                  {actionLoading === 'pay-enterprise' ? 'Opening Paystack...' : `Pay $${enterprisePrice} / mo via Paystack`}
                </span>
              </button>
            </div>
          </div>

          {/* 3. Custom Fleet Plan */}
          <div className="p-6 rounded-3xl bg-gray-900/80 border border-gray-800 flex flex-col justify-between space-y-6 hover:border-gray-700 transition">
            <div className="space-y-4">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Custom Hardware</span>
                <h3 className="text-lg font-bold text-white">Custom Fleet</h3>
                <div className="text-3xl font-extrabold text-white">Custom Quote</div>
                <p className="text-xs text-gray-400">For 30+ devices, custom racks, and tailored SLAs</p>
              </div>

              <div className="space-y-2.5 text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Custom Android Fleet (30+ phones)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Unlimited Computer Host Nodes</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Dedicated Infrastructure & TURN</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Manual Subscriptions by Super Admin</span>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <a
                href="https://wa.me/254706499848?text=Hello%20Vertex%20Support,%20I%20am%20inquiring%20about%20a%20Custom%20Subscription%20Plan%20for%20our%20fleet."
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition flex items-center justify-center gap-2"
              >
                <MessageCircle className="h-4 w-4" />
                <span>WhatsApp: +254706499848</span>
              </a>

              <a
                href="tel:+254706499848"
                className="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold border border-gray-700 transition flex items-center justify-center gap-2"
              >
                <Phone className="h-3.5 w-3.5 text-emerald-400" />
                <span>Call Sales Directly</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default SubscriptionPage;
