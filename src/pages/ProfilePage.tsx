import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bookmark, Camera, Clapperboard, Edit3, Grid, X } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { type PublicUser, useAuth } from '../context/AuthContext';
import { api, extractErrorMessage, uploadMediaFile } from '../lib/api';

interface ProfileOverview {
  profile: PublicUser;
  posts: { id: string; caption: string; media: { id: string; url: string }[]; likesCount: number }[];
  reels: { id: string; caption: string; videoUrl: string }[];
  albumsCount: number;
  saved: { type: 'post' | 'reel'; id: string; caption: string; mediaUrl: string | null }[];
}

export function ProfilePage() {
  const { user, partner, refreshSession } = useAuth();
  const [searchParams] = useSearchParams();
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<'posts' | 'reels' | 'saved'>(
    searchParams.get('tab') === 'saved' ? 'saved' : 'posts'
  );
  const [data, setData] = useState<ProfileOverview | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit profile modal
  const [editOpen, setEditOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async (targetId?: string | null) => {
    setLoading(true);
    try {
      const res = await api.get<ProfileOverview>('/profile/overview', {
        params: targetId ? { userId: targetId } : undefined,
      });
      setData(res.data);
      if (!targetId || targetId === user?.id) {
        setDisplayName(res.data.profile.displayName);
        setUsername(res.data.profile.username);
        setBio(res.data.profile.bio || '');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfile(viewingUserId);
  }, [viewingUserId, user?.id]);

  const isOwnProfile = !viewingUserId || viewingUserId === user?.id;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch('/profile/update', { displayName, username, bio });
      await refreshSession();
      await loadProfile(user?.id);
      setEditOpen(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    try {
      const uploaded = await uploadMediaFile(file, file.name);
      await api.patch('/profile/update', { avatarMediaId: uploaded.id });
      await refreshSession();
      await loadProfile(user?.id);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Switch between My Profile & Partner Profile */}
      {partner && (
        <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-fit">
          <button
            onClick={() => setViewingUserId(user?.id || null)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium ${
              isOwnProfile ? 'bg-white dark:bg-zinc-800 shadow-xs' : 'text-zinc-500'
            }`}
          >
            Your Profile
          </button>
          <button
            onClick={() => {
              setViewingUserId(partner.id);
              if (tab === 'saved') setTab('posts');
            }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium ${
              !isOwnProfile ? 'bg-white dark:bg-zinc-800 shadow-xs' : 'text-zinc-500'
            }`}
          >
            {partner.displayName}
          </button>
        </div>
      )}

      {loading || !data ? (
        <div className="h-44 rounded-2xl bg-zinc-200 dark:bg-zinc-900 animate-pulse" />
      ) : (
        <>
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div className="relative">
              <Avatar name={data.profile.displayName} avatarMediaId={data.profile.avatarMediaId} size="xl" />
              {isOwnProfile && (
                <label
                  title="Change profile photo"
                  className="absolute bottom-0 right-0 p-2 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleAvatarUpload(f);
                    }}
                  />
                </label>
              )}
            </div>

            <div className="flex-1 space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-display text-2xl font-semibold">{data.profile.displayName}</h1>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  @{data.profile.username} · {data.profile.role === 'owner' ? 'Owner' : 'Partner'}
                </span>
                {isOwnProfile && (
                  <button
                    onClick={() => setEditOpen(true)}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Edit Profile
                  </button>
                )}
              </div>

              {data.profile.bio && (
                <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{data.profile.bio}</p>
              )}

              <div className="flex flex-wrap items-center gap-5 pt-2 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                <span>
                  <strong className="text-zinc-900 dark:text-zinc-100">{data.posts.length}</strong> posts
                </span>
                <span>
                  <strong className="text-zinc-900 dark:text-zinc-100">{data.reels.length}</strong> reels
                </span>
                <span>
                  <strong className="text-zinc-900 dark:text-zinc-100">{data.albumsCount}</strong> albums
                </span>
                <span>Joined {new Date(data.profile.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-6 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
            <button
              onClick={() => setTab('posts')}
              className={`py-3 flex items-center gap-1.5 border-b-2 transition-colors ${
                tab === 'posts' ? 'border-zinc-900 dark:border-zinc-100' : 'border-transparent text-zinc-500'
              }`}
            >
              <Grid className="w-4 h-4" /> Posts
            </button>
            <button
              onClick={() => setTab('reels')}
              className={`py-3 flex items-center gap-1.5 border-b-2 transition-colors ${
                tab === 'reels' ? 'border-zinc-900 dark:border-zinc-100' : 'border-transparent text-zinc-500'
              }`}
            >
              <Clapperboard className="w-4 h-4" /> Reels
            </button>
            {isOwnProfile && (
              <button
                onClick={() => setTab('saved')}
                className={`py-3 flex items-center gap-1.5 border-b-2 transition-colors ${
                  tab === 'saved' ? 'border-zinc-900 dark:border-zinc-100' : 'border-transparent text-zinc-500'
                }`}
              >
                <Bookmark className="w-4 h-4" /> Saved
              </button>
            )}
          </div>

          {tab === 'posts' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {data.posts.length === 0 ? (
                <p className="col-span-full text-sm text-zinc-500 py-8 text-center">No posts yet.</p>
              ) : (
                data.posts.map((p) => (
                  <div
                    key={p.id}
                    className="aspect-square rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                  >
                    {p.media[0] && (
                      <img src={p.media[0].url} alt={p.caption || 'Post'} className="w-full h-full object-cover" />
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'reels' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {data.reels.length === 0 ? (
                <p className="col-span-full text-sm text-zinc-500 py-8 text-center">No reels yet.</p>
              ) : (
                data.reels.map((r) => (
                  <div
                    key={r.id}
                    className="aspect-[9/16] rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                  >
                    <video src={r.videoUrl} preload="metadata" controls className="w-full h-full object-cover" />
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'saved' && isOwnProfile && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {data.saved.length === 0 ? (
                <p className="col-span-full text-sm text-zinc-500 py-8 text-center">No saved items yet.</p>
              ) : (
                data.saved.map((item) => (
                  <div
                    key={`${item.type}-${item.id}`}
                    className="relative aspect-square rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                  >
                    {item.mediaUrl &&
                      (item.type === 'reel' ? (
                        <video src={item.mediaUrl} preload="metadata" className="w-full h-full object-cover" />
                      ) : (
                        <img src={item.mediaUrl} alt={item.caption} className="w-full h-full object-cover" />
                      ))}
                    <div className="absolute bottom-0 inset-x-0 p-2.5 bg-gradient-to-t from-black/75 to-transparent text-white text-xs truncate">
                      {item.caption || item.type}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Edit Profile Modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Edit Profile</h2>
              <button onClick={() => setEditOpen(false)} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveProfile} className="space-y-3.5">
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-xs text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Bio</label>
                <textarea
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditOpen(false)} className="px-4 py-2 text-xs">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
