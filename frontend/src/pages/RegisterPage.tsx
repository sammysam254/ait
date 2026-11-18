import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Smartphone, Lock, Mail, Building, User, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError(null);
    try {
      await register(email, fullName, companyName);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-400 flex items-center justify-center mx-auto shadow-xl shadow-indigo-600/30">
            <Smartphone className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Create Customer Account</h1>
          <p className="text-xs text-gray-400">Get your private isolated cloud device farm dashboard</p>
        </div>

        <div className="rounded-3xl bg-gray-900 border border-gray-800 p-8 shadow-2xl space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-gray-300 font-semibold block">Full Name</label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Alex Rivers"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500"
                />
                <User className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-gray-300 font-semibold block">Company / Lab Name</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Acme Mobile Labs"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500"
                />
                <Building className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-gray-300 font-semibold block">Work Email</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  placeholder="alex@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500"
                />
                <Mail className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95"
            >
              {loading ? 'Creating Tenant...' : 'Create Account & Access Dashboard'}
            </button>
          </form>
        </div>

        <div className="text-center text-xs text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-semibold">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};
