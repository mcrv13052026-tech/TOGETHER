import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, extractErrorMessage } from '../lib/api';

interface InviteValidation {
  valid: boolean;
  intendedEmail?: string | null;
  expiresAt?: string;
  inviterName?: string;
  inviterUsername?: string;
  error?: string;
}

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { refreshSession } = useAuth();

  const [checking, setChecking] = useState(true);
  const [validation, setValidation] = useState<InviteValidation | null>(null);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setValidation({ valid: false, error: 'Missing invitation token.' });
      setChecking(false);
      return;
    }

    api
      .get<InviteValidation>(`/invitations/validate?token=${encodeURIComponent(token)}`)
      .then((res) => {
        setValidation(res.data);
        if (res.data.intendedEmail) {
          setEmail(res.data.intendedEmail);
        }
      })
      .catch((err) => {
        setValidation({
          valid: false,
          error: extractErrorMessage(err, 'This invitation link is invalid or expired.'),
        });
      })
      .finally(() => setChecking(false));
  }, [token]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/invitations/accept', {
        token,
        email,
        username,
        displayName,
        password,
      });
      await refreshSession();
      navigate('/');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8">
        <div className="mb-6">
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Private Invitation · Slot 2 of 2</p>
          <h1 className="font-display text-2xl font-semibold mt-1">Join TogetherSpace</h1>
        </div>

        {checking ? (
          <div className="py-10 text-center text-sm text-zinc-500">Verifying cryptographic invitation token...</div>
        ) : !validation?.valid ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="text-sm text-rose-800 dark:text-rose-200">
                <p className="font-semibold">Invitation Unavailable</p>
                <p className="mt-1">{validation?.error}</p>
              </div>
            </div>
            <Link
              to="/"
              className="block w-full text-center py-2.5 px-4 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium"
            >
              Return to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleAccept} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 flex items-start gap-3 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">
                  Invited by {validation.inviterName} (@{validation.inviterUsername})
                </p>
                {validation.intendedEmail && (
                  <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Bound to email: {validation.intendedEmail}
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1">Email Address</label>
              <input
                type="email"
                required
                readOnly={Boolean(validation.intendedEmail)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm read-only:opacity-70"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Display Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Samira Chen"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="samira"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Password (min 8 chars)</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {submitting ? 'Joining TogetherSpace...' : 'Accept Invitation & Create Account'}
            </button>

            <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 pt-2">
              <Shield className="w-3.5 h-3.5 shrink-0" />
              Single-use token · Creating this account completes the 2-account limit.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
