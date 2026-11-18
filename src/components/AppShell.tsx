import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Bookmark,
  CirclePlus,
  Clapperboard,
  FolderHeart,
  Home,
  LogOut,
  MailCheck,
  MessageCircle,
  Moon,
  Search,
  Settings,
  Sparkles,
  Sun,
  User,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api, extractErrorMessage, formatRelativeTime } from '../lib/api';
import { Avatar } from './Avatar';
import { CallOverlay } from './CallOverlay';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, partner, unreadNotifications, devEmails, logout, refreshSession } = useAuth();
  const { resolved, setMode } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [verifyPreviewUrl, setVerifyPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (devEmails.length > 0 && !user?.emailVerified) {
      const latest = devEmails.find((e) => e.actionUrl && e.subject.toLowerCase().includes('verify'));
      if (latest?.actionUrl) setVerifyPreviewUrl(latest.actionUrl);
    }
  }, [devEmails, user?.emailVerified]);

  const loadNotifications = async () => {
    try {
      const res = await api.get<{ notifications: NotificationItem[] }>('/notifications/list');
      setNotifications(res.data.notifications);
      await api.post('/notifications/read-all');
      await refreshSession();
    } catch {
      // ignore
    }
  };

  const handleToggleNotifs = () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) void loadNotifications();
  };

  const handleResendVerify = async () => {
    setResendingEmail(true);
    setVerifyNotice(null);
    try {
      const res = await api.post('/auth/resend-verification');
      if (res.data.devPreviewUrl) {
        setVerifyPreviewUrl(res.data.devPreviewUrl);
      }
      setVerifyNotice('Verification email sent.');
    } catch (err) {
      setVerifyNotice(extractErrorMessage(err));
    } finally {
      setResendingEmail(false);
    }
  };

  const navItems = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/explore', label: 'Explore', icon: Search },
    { to: '/reels', label: 'Reels', icon: Clapperboard },
    { to: '/stories', label: 'Stories', icon: Sparkles },
    { to: '/messages', label: 'Messages', icon: MessageCircle },
    { to: '/albums', label: 'Albums', icon: FolderHeart },
    { to: '/profile', label: 'Profile', icon: User },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  const isReels = location.pathname === '/reels';

  return (
    <div className="min-h-screen flex bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-4 py-6 z-30">
        <div className="flex items-center justify-between px-3 mb-7">
          <Link to="/" className="font-display text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 whitespace-nowrap">
            TogetherSpace
          </Link>
          <button
            onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {resolved === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/70'
                  }`
                }
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          <button
            onClick={() => navigate('/?compose=1')}
            className="w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-sm font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap mt-2"
          >
            <CirclePlus className="w-[18px] h-[18px] shrink-0" />
            <span>Create Post</span>
          </button>

          <button
            onClick={handleToggleNotifs}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/70 transition-colors whitespace-nowrap"
          >
            <span className="flex items-center gap-3.5">
              <Bell className="w-[18px] h-[18px] shrink-0" />
              <span>Notifications</span>
            </span>
            {unreadNotifications > 0 && (
              <span className="text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                {unreadNotifications}
              </span>
            )}
          </button>
        </nav>

        <div className="pt-4 mt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          {user && (
            <div className="flex items-center justify-between gap-2 px-2">
              <Link to="/profile" className="flex items-center gap-2.5 min-w-0">
                <Avatar name={user.displayName} avatarMediaId={user.avatarMediaId} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user.displayName}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    @{user.username} · {partner ? 'Connected' : 'Solo'}
                  </p>
                </div>
              </Link>
              <button
                onClick={logout}
                aria-label="Sign out"
                title="Sign out"
                className="p-2 rounded-lg text-zinc-500 hover:text-rose-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="px-2 flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <Link to="/privacy-policy" className="hover:underline">
              Privacy
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/terms" className="hover:underline">
              Terms
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/profile?tab=saved" className="hover:underline flex items-center gap-1">
              <Bookmark className="w-3 h-3" /> Saved
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Compact Mobile Header (52px) */}
        <header className="lg:hidden sticky top-0 z-30 h-13 px-4 flex items-center justify-between bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800">
          <Link to="/" className="font-display text-lg font-semibold tracking-tight whitespace-nowrap">
            TogetherSpace
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate('/?compose=1')}
              aria-label="Create post"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-200"
            >
              <CirclePlus className="w-5 h-5" />
            </button>
            <button
              onClick={handleToggleNotifs}
              aria-label="Notifications"
              className="relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-200"
            >
              <Bell className="w-5 h-5" />
              {unreadNotifications > 0 && (
                <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-rose-600" />
              )}
            </button>
            <button
              onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-700 dark:text-zinc-200"
            >
              {resolved === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Email Verification Gate Banner */}
        {user && !user.emailVerified && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60 px-4 py-3">
            <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2.5 text-amber-900 dark:text-amber-200">
                <MailCheck className="w-4 h-4 shrink-0" />
                <span>
                  Verify <strong>{user.email}</strong> to unlock posting, private chat, Google Drive, and calls.
                </span>
              </div>
              <div className="flex items-center gap-3">
                {verifyPreviewUrl && (
                  <a
                    href={verifyPreviewUrl}
                    className="text-xs font-semibold underline text-amber-900 dark:text-amber-100"
                  >
                    Open Verification Link
                  </a>
                )}
                <button
                  onClick={handleResendVerify}
                  disabled={resendingEmail}
                  className="px-3 py-1.5 rounded-lg bg-amber-900 text-white dark:bg-amber-200 dark:text-amber-950 text-xs font-medium disabled:opacity-60"
                >
                  {resendingEmail ? 'Sending...' : 'Resend Link'}
                </button>
              </div>
            </div>
            {verifyNotice && (
              <p className="max-w-4xl mx-auto mt-1 text-xs text-amber-800 dark:text-amber-300">{verifyNotice}</p>
            )}
          </div>
        )}

        <main className={`flex-1 ${isReels ? 'pb-16 lg:pb-0' : 'pb-20 lg:pb-8'}`}>{children}</main>

        {/* Mobile Bottom Navigation (56px, total sticky < 15% viewport) */}
        <nav
          aria-label="Mobile navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-14 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-5 items-center"
        >
          {[
            { to: '/', label: 'Home', icon: Home },
            { to: '/reels', label: 'Reels', icon: Clapperboard },
            { to: '/messages', label: 'Chat', icon: MessageCircle },
            { to: '/albums', label: 'Albums', icon: FolderHeart },
            { to: '/settings', label: 'Settings', icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center min-h-[44px] text-[10px] font-medium ${
                    isActive
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`
                }
              >
                <Icon className="w-5 h-5 mb-0.5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Notifications Drawer */}
      {notifOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs" onClick={() => setNotifOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 h-full flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="text-base font-semibold">Notifications</h2>
              <button
                onClick={() => setNotifOpen(false)}
                aria-label="Close notifications"
                className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
              {notifications.length === 0 ? (
                <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">No recent notifications.</p>
              ) : (
                notifications.map((n) => (
                  <Link
                    key={n.id}
                    to={n.link}
                    onClick={() => setNotifOpen(false)}
                    className="block px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{n.body}</p>
                    <p className="text-[11px] text-zinc-400 mt-1">{formatRelativeTime(n.createdAt)}</p>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <CallOverlay />
    </div>
  );
}
