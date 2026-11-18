import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Check,
  Copy,
  Download,
  HardDrive,
  KeyRound,
  Laptop,
  Link2Off,
  ShieldAlert,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api, extractErrorMessage, formatBytes, formatRelativeTime } from '../lib/api';

interface InviteItem {
  id: string;
  intendedEmail: string | null;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: string;
  createdAt: string;
}

interface StorageStatus {
  oauthConfigured: boolean;
  connected: boolean;
  status: string;
  googleEmail: string | null;
  grantedScopes: string[];
  quotaTotalBytes: number | null;
  quotaUsedBytes: number | null;
  togetherSpaceUsageBytes: number;
  driveStoredBytes: number;
  localVaultBytes: number;
  mediaCount: number;
  quotaNote: string;
}

interface SessionItem {
  id: string;
  userAgent: string;
  ipAddress: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

interface AuditLogItem {
  id: string;
  action: string;
  ipAddress: string;
  createdAt: string;
}

export function SettingsPage() {
  const { user, partner, connection, capabilities, refreshSession, logout } = useAuth();
  const { mode, setMode } = useTheme();
  const [searchParams] = useSearchParams();

  const [invitations, setInvitations] = useState<InviteItem[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  const [relTitle, setRelTitle] = useState(connection?.relationshipTitle || 'Our Private Space');
  const [anniversary, setAnniversary] = useState(connection?.anniversaryDate || '');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmDeleteText, setConfirmDeleteText] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const notify = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 5000);
  };

  const loadAll = async () => {
    try {
      const [storageRes, sessRes, logsRes] = await Promise.all([
        api.get<StorageStatus>('/google/storage'),
        api.get<{ sessions: SessionItem[] }>('/privacy/sessions'),
        api.get<{ logs: AuditLogItem[] }>('/privacy/audit-logs'),
      ]);
      setStorage(storageRes.data);
      setSessions(sessRes.data.sessions);
      setAuditLogs(logsRes.data.logs);

      if (user?.role === 'owner') {
        const invRes = await api.get<{ invitations: InviteItem[] }>('/invitations/status');
        setInvitations(invRes.data.invitations);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadAll();
    const gStatus = searchParams.get('google');
    const gError = searchParams.get('google_error');
    if (gStatus === 'connected') notify('ok', 'Google Drive connected successfully.');
    if (gError) notify('err', `Google Drive authorization failed (${gError}).`);
  }, [user?.role]);

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<{ inviteUrl: string }>('/invitations/create', {
        intendedEmail: inviteEmail,
        expiresInHours: 168,
      });
      setGeneratedInviteUrl(res.data.inviteUrl);
      setInviteEmail('');
      await loadAll();
      notify('ok', 'Single-use invitation created. Previous pending links were revoked.');
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleRevokeInvites = async () => {
    try {
      await api.post('/invitations/revoke', {});
      setGeneratedInviteUrl(null);
      await loadAll();
      notify('ok', 'Pending invitation revoked.');
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleCopyInvite = async () => {
    if (!generatedInviteUrl) return;
    await navigator.clipboard.writeText(generatedInviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConnectGoogle = async () => {
    try {
      const res = await api.get<{ url: string }>('/google/connect');
      window.location.href = res.data.url;
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleDisconnectGoogle = async () => {
    try {
      const res = await api.post<{ message: string }>('/google/disconnect');
      await loadAll();
      await refreshSession();
      notify('ok', res.data.message);
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleUpdateConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.patch('/connection/details', {
        relationshipTitle: relTitle,
        anniversaryDate: anniversary || null,
      });
      await refreshSession();
      notify('ok', 'Connection details updated.');
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleDisconnectPartner = async () => {
    try {
      const res = await api.post<{ message: string }>('/connection/disconnect');
      setConfirmDisconnect(false);
      if (user?.role === 'partner') {
        await logout();
      } else {
        await refreshSession();
        await loadAll();
        notify('ok', res.data.message);
      }
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<{ message: string }>('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      await loadAll();
      notify('ok', res.data.message);
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleRevokeSession = async (sessionId?: string) => {
    try {
      await api.post('/privacy/revoke-sessions', sessionId ? { sessionId } : {});
      await loadAll();
      notify('ok', sessionId ? 'Session signed out.' : 'All other sessions signed out.');
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handlePreferenceToggle = async (
    group: 'privacyPrefs' | 'notificationPrefs',
    key: string,
    value: boolean
  ) => {
    try {
      await api.patch('/privacy/preferences', { [group]: { [key]: value } });
      await refreshSession();
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  const handleExportData = () => {
    window.location.href = '/api/privacy/export';
  };

  const handleDeleteAccount = async () => {
    try {
      await api.post('/privacy/delete-account', { confirm: confirmDeleteText });
      await logout();
    } catch (err) {
      notify('err', extractErrorMessage(err));
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Settings & Privacy</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Manage your partner invitation, Google Drive storage, security sessions, and privacy controls.
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* 1. Partner Invitation & Private Connection */}
      <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Private Connection (2-Account Limit)</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Account visibility is private by default. Only two approved accounts can ever exist.
            </p>
          </div>
          <span className="text-xs font-medium text-zinc-500 tabular-nums">
            {partner ? '2 / 2 Connected' : '1 / 2 Active'}
          </span>
        </div>

        {partner ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">
                  Connected with {partner.displayName} (@{partner.username})
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Email verified: {partner.emailVerified ? 'Yes' : 'Pending verification'}
                  {connection?.connectedAt
                    ? ` · Connected ${new Date(connection.connectedAt).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
              <button
                onClick={() => setConfirmDisconnect(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                <Link2Off className="w-3.5 h-3.5" /> Disconnect Partner
              </button>
            </div>

            <form onSubmit={handleUpdateConnection} className="grid sm:grid-cols-[1fr_180px_auto] gap-3 items-end">
              <div>
                <label className="block text-xs font-medium mb-1">Connection Title</label>
                <input
                  type="text"
                  value={relTitle}
                  onChange={(e) => setRelTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Anniversary Date</label>
                <input
                  type="date"
                  value={anniversary}
                  onChange={(e) => setAnniversary(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
              >
                Save
              </button>
            </form>
          </div>
        ) : user?.role === 'owner' ? (
          <div className="space-y-4">
            <form onSubmit={handleCreateInvite} className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Partner email address (optional binding)"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />
              <button
                type="submit"
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shrink-0"
              >
                <UserPlus className="w-4 h-4" /> Generate Single-Use Invite
              </button>
            </form>

            {generatedInviteUrl && (
              <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2">
                <p className="text-xs font-semibold">Shareable Private Invitation Link (Single-Use)</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={generatedInviteUrl}
                    className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-mono-tabular"
                  />
                  <button
                    onClick={() => void handleCopyInvite()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {invitations.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Invitation History</p>
                  {invitations.some((i) => i.status === 'pending') && (
                    <button
                      onClick={() => void handleRevokeInvites()}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Revoke Pending Invite
                    </button>
                  )}
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                  {invitations.slice(0, 5).map((inv) => (
                    <div key={inv.id} className="py-2 flex items-center justify-between gap-2">
                      <span>{inv.intendedEmail || 'Any email via link'}</span>
                      <span className="text-zinc-500 capitalize">
                        {inv.status} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* 2. Personal Google Drive Connection */}
      <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-zinc-500" /> Personal Google Drive Storage
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Each person connects their own Google account using minimal <code className="font-mono-tabular">drive.file</code> scope.
            </p>
          </div>
          {storage?.connected ? (
            <button
              onClick={() => void handleDisconnectGoogle()}
              className="px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Disconnect Drive
            </button>
          ) : (
            <button
              onClick={() => void handleConnectGoogle()}
              className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
            >
              Connect Google Drive
            </button>
          )}
        </div>

        {storage && (
          <div className="grid sm:grid-cols-3 gap-4 pt-2 text-xs">
            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-zinc-500">Connection Status</p>
              <p className="font-semibold mt-1 capitalize">
                {storage.connected ? `Connected (${storage.googleEmail})` : storage.status}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-zinc-500">Google Account Quota</p>
              <p className="font-semibold mt-1 tabular-nums">
                {storage.quotaTotalBytes !== null
                  ? `${formatBytes(storage.quotaUsedBytes)} / ${formatBytes(storage.quotaTotalBytes)}`
                  : 'Connect Google to view quota'}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-zinc-500">Your TogetherSpace Media</p>
              <p className="font-semibold mt-1 tabular-nums">
                {formatBytes(storage.togetherSpaceUsageBytes)} · {storage.mediaCount} files
              </p>
            </div>
          </div>
        )}

        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {storage?.quotaNote}{' '}
          {!storage?.oauthConfigured &&
            'Note: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in this environment, so uploads are stored privately in the authenticated local vault until configured.'}
        </p>
      </section>

      {/* 3. Theme & Privacy Preferences */}
      <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-5">
        <h2 className="text-base font-semibold">Appearance & Privacy Controls</h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Theme</p>
            <p className="text-xs text-zinc-500">Respects system theme initially or overrides manually.</p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
            {(['system', 'light', 'dark'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
                  mode === m ? 'bg-white dark:bg-zinc-800 shadow-xs' : 'text-zinc-500'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {user && (
          <div className="space-y-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-sm">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-medium">Send Read Receipts</p>
                <p className="text-xs text-zinc-500">Let your partner see when you have read their messages.</p>
              </div>
              <input
                type="checkbox"
                checked={user.privacyPrefs.readReceipts}
                onChange={(e) => void handlePreferenceToggle('privacyPrefs', 'readReceipts', e.target.checked)}
              />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-medium">Show Online Presence</p>
                <p className="text-xs text-zinc-500">Display active status when TogetherSpace is open.</p>
              </div>
              <input
                type="checkbox"
                checked={user.privacyPrefs.onlinePresence}
                onChange={(e) => void handlePreferenceToggle('privacyPrefs', 'onlinePresence', e.target.checked)}
              />
            </label>
          </div>
        )}
      </section>

      {/* 4. Security, Password & Sessions */}
      <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-zinc-500" /> Password & Active Sessions
          </h2>
          <button
            onClick={() => void handleRevokeSession()}
            className="text-xs font-medium text-rose-600 hover:underline"
          >
            Log out all other devices
          </button>
        </div>

        <form onSubmit={handleChangePassword} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1">Current Password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">New Password (min 8 chars)</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
          >
            Update Password
          </button>
        </form>

        <div className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Connected Devices</p>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sessions.map((s) => (
              <div key={s.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Laptop className="w-4 h-4 text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {s.userAgent} {s.isCurrent ? '(This session)' : ''}
                    </p>
                    <p className="text-zinc-500">
                      IP {s.ipAddress} · Last active {formatRelativeTime(s.lastActiveAt)}
                    </p>
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    onClick={() => void handleRevokeSession(s.id)}
                    className="text-rose-600 hover:underline shrink-0"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {auditLogs.length > 0 && (
          <details className="pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
            <summary className="cursor-pointer font-semibold text-zinc-600 dark:text-zinc-300">
              Security Audit Log ({auditLogs.length})
            </summary>
            <div className="mt-2 space-y-1.5 max-h-44 overflow-y-auto">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between text-zinc-500">
                  <span className="font-mono-tabular">{log.action}</span>
                  <span>{formatRelativeTime(log.createdAt)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* 5. Data Export, Legal & Account Deletion */}
      <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
        <h2 className="text-base font-semibold">Data Portability & Account Deletion</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExportData}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <Download className="w-3.5 h-3.5" /> Export Personal Data (JSON)
          </button>

          <button
            onClick={() => setConfirmDeleteOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 text-xs font-medium hover:bg-rose-50 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="w-3.5 h-3.5" /> Request Account Deletion
          </button>
        </div>

        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <span>
            Stack mode: {capabilities?.database === 'mongodb' ? 'MongoDB Atlas' : 'Local Persistent Store'} · Realtime:{' '}
            {capabilities?.ablyConfigured ? 'Ably + SSE' : 'SSE'}
          </span>
          <div className="flex items-center gap-4">
            <Link to="/privacy-policy" className="hover:underline">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:underline">
              Terms & Conditions
            </Link>
          </div>
        </div>
      </section>

      {/* Confirm Disconnect Partner Modal */}
      {confirmDisconnect && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold">Disconnect Private Connection?</h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                  Disconnecting revokes the partner’s access to TogetherSpace and opens the second slot for recovery.
                  This will <strong>not</strong> delete any files stored in either person’s personal Google Drive.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDisconnect(false)} className="px-4 py-2 text-xs">
                Cancel
              </button>
              <button
                onClick={() => void handleDisconnectPartner()}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold"
              >
                Confirm Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Account Deletion Modal */}
      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
            <h3 className="text-base font-semibold text-rose-600">Delete TogetherSpace Account</h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Your TogetherSpace account and stored OAuth tokens will be deactivated immediately. Original files stored
              inside your personal Google Drive and the other user’s files are <strong>not</strong> deleted. Type{' '}
              <strong>DELETE</strong> below to confirm.
            </p>
            <input
              type="text"
              value={confirmDeleteText}
              onChange={(e) => setConfirmDeleteText(e.target.value)}
              placeholder="Type DELETE"
              className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteOpen(false)} className="px-4 py-2 text-xs">
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteAccount()}
                disabled={confirmDeleteText !== 'DELETE'}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                Permanently Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
