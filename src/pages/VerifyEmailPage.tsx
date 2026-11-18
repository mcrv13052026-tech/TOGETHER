import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, extractErrorMessage } from '../lib/api';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { refreshSession } = useAuth();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('Verifying your email address...');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Verification token is missing.');
      return;
    }

    api
      .post('/auth/verify-email', { token })
      .then(async () => {
        setStatus('success');
        setMessage('Your email address has been verified. TogetherSpace is now unlocked.');
        await refreshSession();
      })
      .catch((err) => {
        setStatus('error');
        setMessage(extractErrorMessage(err, 'Verification link is invalid or expired.'));
      });
  }, [token, refreshSession]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 text-center space-y-4">
        {status === 'success' ? (
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
        ) : status === 'error' ? (
          <XCircle className="w-10 h-10 text-rose-600 mx-auto" />
        ) : null}
        <h1 className="font-display text-2xl font-semibold">Email Verification</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
        <Link
          to="/"
          className="inline-block px-5 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium"
        >
          Continue to TogetherSpace
        </Link>
      </div>
    </div>
  );
}
