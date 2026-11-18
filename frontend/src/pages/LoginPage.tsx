import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Smartphone, Lock, Mail, ArrowRight, Shield, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const LoginPage: React.FC = () => {
  const { login, switchAccountDemo } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (demoEmail: string) => {
    setLoading(true);
    try {
      await switchAccountDemo(demoEmail);
      navigate('/dashboard');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-400 flex items-center justify-center mx-auto shadow-xl shadow-indigo-600/30">
            <Smartphone className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Vertex Cloud Device Farm</h1>
          <p className="text-xs text-gray-400">Enterprise scrcpy 3.3.4 Multi-Tenant SaaS Platform</p>
        </div>

        {/* Form Card */}
        <div className="rounded-3xl bg-gray-900 border border-gray-800 p-8 shadow-2xl space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs">
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
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500"
                />
                <Mail className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-gray-300 font-semibold block">Password</label>
              <div className="relative">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500"
                />
                <Lock className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95"
            >
              {loading ? 'Signing in...' : 'Sign In to Dashboard'}
            </button>
          </form>

          {/* Quick Demo Personas */}
          <div className="pt-4 border-t border-gray-800 space-y-2">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-center">
              One-Click Instant Test Personas
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <button
                onClick={() => handleQuickLogin('customerA@enterprise.local')}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-left text-gray-200 transition"
              >
                <div className="font-bold text-indigo-400">Customer A</div>
                <div className="text-[10px] text-gray-400 truncate">customerA@enterprise.local</div>
              </button>
              <button
                onClick={() => handleQuickLogin('customerB@fintech.local')}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-left text-gray-200 transition"
              >
                <div className="font-bold text-indigo-400">Customer B</div>
                <div className="text-[10px] text-gray-400 truncate">customerB@fintech.local</div>
              </button>
              <button
                onClick={() => handleQuickLogin('assigned.user@partner.local')}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-left text-gray-200 transition"
              >
                <div className="font-bold text-amber-400">Assigned User</div>
                <div className="text-[10px] text-gray-400 truncate">Subordinate Tester</div>
              </button>
              <button
                onClick={() => handleQuickLogin('admin@vertex-saas.local')}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-left text-gray-200 transition"
              >
                <div className="font-bold text-purple-400">Super Admin</div>
                <div className="text-[10px] text-gray-400 truncate">Platform Admin</div>
              </button>
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-gray-500">
          Don't have an account?{' '}
          <Link to="/register" className="text-indigo-400 hover:text-indigo-300 font-semibold">
            Create Customer Account
          </Link>
        </div>
      </div>
    </div>
  );
};
