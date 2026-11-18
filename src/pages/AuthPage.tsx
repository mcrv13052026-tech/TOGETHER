import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api, extractErrorMessage } from '../lib/api';

interface BootstrapStatus {
  hasOwner: boolean;
  activeAccountCount: number;
  maxAccounts: number;
}

export function AuthPage() {
  const { refreshSession } = useAuth();
  const { resolved, setMode } = useTheme();
  const [bootstrap, setBootstrap] = useState<BootstrapStatus | null>(null);
  const [mode, setAuthMode] = useState<'login' | 'owner_setup' | 'forgot'>('login');

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devPreviewUrl, setDevPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<BootstrapStatus>('/auth/bootstrap-status')
      .then((res) => {
        setBootstrap(res.data);
        setAuthMode(res.data.hasOwner ? 'login' : 'owner_setup');
      })
      .catch(() => {
        setAuthMode('login');
      });
  }, []);

  const handleOwnerSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post('/auth/register-owner', {
        email,
        username,
        displayName,
        password,
      });
      if (res.data.devPreviewUrl) setDevPreviewUrl(res.data.devPreviewUrl);
      await refreshSession();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/login', {
        emailOrUsername: email,
        password,
      });
      await refreshSession();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    setDevPreviewUrl(null);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setInfo(res.data.message);
      if (res.data.devPreviewUrl) setDevPreviewUrl(res.data.devPreviewUrl);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Left Visual Editorial Column */}
      <div className="relative hidden lg:flex flex-col justify-between p-10 bg-zinc-900 text-white overflow-hidden">
        <img
          src="/src/assets/images/auth_hero_editorial_1795010747671.jpg"
          alt="Sunlit cafe table with two espresso cups and a 35mm camera"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-75"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/40" />

        <div className="relative z-10 flex items-center justify-between">
          <span className="font-display text-2xl font-semibold tracking-tight">TogetherSpace</span>
          <span className="text-xs text-zinc-300">Private Edition · Maximum 2 Accounts</span>
        </div>

        <div className="relative z-10 max-w-lg space-y-4">
          <h1 className="font-display text-4xl font-semibold leading-tight text-balance">
            A quiet, private social space built strictly for two.
          </h1>
          <p className="text-sm text-zinc-200 leading-relaxed">
            Share photos, reels, 24-hour stories, private albums, voice messages, and encrypted peer calls. Every media
            upload stays in your own personal Google Drive or private vault—never publicly discoverable.
          </p>
          <div className="flex items-center gap-4 text-xs text-zinc-300 pt-2">
            <span>Invitation-only second seat</span>
            <span aria-hidden="true">·</span>
            <span>No public feeds or search</span>
            <span aria-hidden="true">·</span>
            <span>Personal Drive ownership</span>
          </div>
        </div>
      </div>

      {/* Right Authentication Form Column */}
      <div className="flex flex-col justify-between p-6 sm:p-12">
        <div className="flex items-center justify-between">
          <span className="lg:hidden font-display text-xl font-semibold">TogetherSpace</span>
          <button
            onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
            className="ml-auto text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {resolved === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
        </div>

        <div className="w-full max-w-md mx-auto my-auto py-8">
          <div className="mb-8">
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400 mb-2">
              {mode === 'owner_setup'
                ? 'Initial Setup · Account 1 of 2'
                : mode === 'forgot'
                ? 'Account Recovery'
                : 'Private Sign In'}
            </p>
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              {mode === 'owner_setup'
                ? 'Create Owner Account'
                : mode === 'forgot'
                ? 'Reset your password'
                : 'Welcome back'}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              {mode === 'owner_setup'
                ? 'Set up the primary owner account. Once created, you can invite one partner via a single-use link.'
                : mode === 'forgot'
                ? 'Enter your email address to receive a time-limited password reset link.'
                : 'Public registration is disabled. Sign in with an approved TogetherSpace account.'}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {info && (
            <div className="mb-5 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-sm text-emerald-800 dark:text-emerald-200">
              <p>{info}</p>
              {devPreviewUrl && (
                <a href={devPreviewUrl} className="inline-block mt-2 font-semibold underline">
                  Open Local Dev Reset Link
                </a>
              )}
            </div>
          )}

          {mode === 'owner_setup' && (
            <form onSubmit={handleOwnerSetup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="alex"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Password (minimum 8 characters)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {submitting ? 'Creating Owner Account...' : 'Initialize Owner Account'}
              </button>
            </form>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Email or Username
                </label>
                <input
                  type="text"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setAuthMode('forgot');
                    }}
                    className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {submitting ? 'Signing In...' : 'Sign In'}
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {submitting ? 'Sending Reset Link...' : 'Send Password Reset Link'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  setAuthMode('login');
                }}
                className="w-full text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 py-1"
              >
                Back to Sign In
              </button>
            </form>
          )}

          {bootstrap && (
            <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800 flex items-start gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-zinc-400" />
              <div>
                <p className="font-medium text-zinc-700 dark:text-zinc-300">
                  {bootstrap.activeAccountCount} of {bootstrap.maxAccounts} approved accounts active
                </p>
                <p className="mt-0.5">
                  Authentication uses HTTP-only cookies and bcrypt hashing. Have an invite link? Open it directly in your
                  browser to join as the second member.
                </p>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <span className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> Private Space
          </span>
          <div className="flex items-center gap-4">
            <Link to="/privacy-policy" className="hover:underline">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:underline">
              Terms
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
