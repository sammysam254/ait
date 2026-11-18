import React from 'react';
import { CreditCard, Check, Shield, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const SubscriptionPage: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Subscription & Quota Plans</h1>
        <p className="text-xs md:text-sm text-gray-400">
          Scale your cloud device farm with multi-host streaming and unlimited shared sessions
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Starter Plan */}
        <div className="p-6 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">Starter</h3>
            <div className="text-2xl font-extrabold text-white">$49<span className="text-xs font-normal text-gray-400">/mo</span></div>
            <p className="text-xs text-gray-400">For individual developers and small QA rigs</p>
          </div>
          <div className="space-y-2 text-xs text-gray-300">
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> Up to 5 Connected Android Phones</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> 2 Registered Windows Hosts</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> WebRTC & WebSocket Streaming</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> PIN-Protected Device Sharing</div>
          </div>
          <button className="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold">
            {user?.plan === 'starter' ? 'Current Plan' : 'Select Plan'}
          </button>
        </div>

        {/* Pro Plan */}
        <div className="p-6 rounded-2xl bg-indigo-950/40 border-2 border-indigo-500/50 space-y-4 relative shadow-2xl">
          <div className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full bg-indigo-600 text-[10px] font-bold text-white uppercase tracking-wider">
            Popular
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">Pro Farm</h3>
            <div className="text-2xl font-extrabold text-white">$149<span className="text-xs font-normal text-gray-400">/mo</span></div>
            <p className="text-xs text-gray-400">For scaling software teams and test automation</p>
          </div>
          <div className="space-y-2 text-xs text-gray-300">
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> Up to 20 Connected Android Phones</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> 5 Registered Windows Hosts</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> Cloudflare Outbound Tunnels</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> Subordinate Account Assignments</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> Full Audit Logs & Rate Limiting</div>
          </div>
          <button className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30">
            {user?.plan === 'pro' ? 'Current Plan' : 'Upgrade to Pro'}
          </button>
        </div>

        {/* Enterprise */}
        <div className="p-6 rounded-2xl bg-gray-900/70 border border-gray-800 space-y-4">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">Enterprise</h3>
            <div className="text-2xl font-extrabold text-white">Custom</div>
            <p className="text-xs text-gray-400">For dedicated device racks and custom SLA</p>
          </div>
          <div className="space-y-2 text-xs text-gray-300">
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> Unlimited Devices & Hosts</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> Dedicated TURN / WebRTC Relays</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> SSO & Custom Roles</div>
            <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> 99.9% Uptime Guarantee</div>
          </div>
          <button className="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold">
            Contact Sales
          </button>
        </div>
      </div>
    </div>
  );
};
