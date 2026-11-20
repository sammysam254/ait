import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone, Lock, Mail, Building, User, Eye, EyeOff, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ApiService } from '../services/api';

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Invite parameters from email link
  const inviteToken = searchParams.get('inviteToken') || searchParams.get('token') || '';
  const initialEmail = searchParams.get('email') || '';

  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite metadata
  const [inviteOrgName, setInviteOrgName] = useState<string | null>(null);
  const [inviteValidating, setInviteValidating] = useState(!!inviteToken);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    if (inviteToken) {
      validateInvite();
    }
  }, [inviteToken]);

  const validateInvite = async () => {
    setInviteValidating(true);
    setInviteError(null);
    try {
      const res = await ApiService.getInviteInfo(inviteToken);
      if (res.valid) {
        if (res.email) setEmail(res.email);
        if (res.fullName && !fullName) setFullName(res.fullName);
        if (res.orgName) setInviteOrgName(res.orgName);
      } else {
        setInviteError(res.error || 'Invalid or expired invitation link.');
      }
    } catch (err: any) {
      console.warn('Invite validation exception:', err);
      // Fallback: If network check fails, trust initial query param if present
      if (initialEmail) {
        setEmail(initialEmail);
      }
    } finally {
      setInviteValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await register(email, password, fullName, inviteToken ? undefined : companyName, inviteToken || undefined);
      // If invited worker, take directly to assigned devices fleet
      if (inviteToken) {
        navigate('/devices');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const isInvite = !!inviteToken;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-400 flex items-center justify-center mx-auto shadow-xl shadow-indigo-600/30">
            <Smartphone className="h-6 w-6 text-white" />
          </div>

          {isInvite ? (
            <>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                <CheckCircle2 className="h-3.5 w-3.5 text-indigo-400" />
                <span>Team Member Invitation</span>
              </div>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">
                Join {inviteOrgName || 'Cloud Device Farm'}
              </h1>
              <p className="text-xs text-gray-400">
                Set your password to gain instant access to your assigned Android devices
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">Create Customer Account</h1>
              <p className="text-xs text-gray-400">Get your private isolated cloud device farm dashboard</p>
            </>
          )}
        </div>

        <div className="rounded-3xl bg-gray-900 border border-gray-800 p-8 shadow-2xl space-y-4">
          {inviteError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <strong>Invitation Notice:</strong> {inviteError}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs">
                {error}
              </div>
            )}

            {/* Email Address */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-gray-300 font-semibold block">
                  {isInvite ? 'Assigned Work Email' : 'Work Email'}
                </label>
                {isInvite && (
                  <span className="text-[10px] text-indigo-400 font-medium">Locked to Invitation</span>
                )}
              </div>
              <div className="relative">
                <input
                  type="email"
                  required
                  readOnly={isInvite}
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2.5 rounded-xl border text-xs focus:outline-none ${
                    isInvite
                      ? 'bg-gray-950/80 border-indigo-500/40 text-indigo-200 cursor-not-allowed select-none font-medium'
                      : 'bg-gray-950 border-gray-800 text-gray-100 focus:border-indigo-500'
                  }`}
                />
                <Mail className={`h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 ${isInvite ? 'text-indigo-400' : 'text-gray-500'}`} />
              </div>
            </div>

            {/* Full Name */}
            <div className="space-y-1.5">
              <label className="text-gray-300 font-semibold block">Full Name</label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Samson Matata"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500 text-xs"
                />
                <User className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {/* Company Name (only shown for primary customer registration) */}
            {!isInvite && (
              <div className="space-y-1.5">
                <label className="text-gray-300 font-semibold block">Company / Lab Name</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Vertex Digital"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500 text-xs"
                  />
                  <Building className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                </div>
              </div>
            )}

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-gray-300 font-semibold block">
                {isInvite ? 'Create Account Password' : 'Password'}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Minimum 6 characters"
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

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label className="text-gray-300 font-semibold block">Confirm Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-gray-950 border border-gray-800 text-gray-100 focus:outline-none focus:border-indigo-500 text-xs"
                />
                <ShieldCheck className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || inviteValidating}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition transform active:scale-95 disabled:opacity-50 mt-2"
            >
              {loading
                ? (isInvite ? 'Setting Password & Linking Account...' : 'Creating Account & Initializing Tenant...')
                : (isInvite ? 'Set Password & Access Assigned Devices →' : 'Create Account & Access Dashboard')}
            </button>
          </form>

          <div className="pt-2 text-center border-t border-gray-800/80">
            <span className="text-gray-500 text-xs">Already registered? </span>
            <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-semibold text-xs">
              Sign In with Email & Password
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
