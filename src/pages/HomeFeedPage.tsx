import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Edit3,
  HardDrive,
  Heart,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  Share2,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { type PublicUser, useAuth } from '../context/AuthContext';
import { api, extractErrorMessage, formatBytes, formatRelativeTime, uploadMediaFile } from '../lib/api';

interface FeedMedia {
  id: string;
  mediaType: 'photo' | 'video' | 'audio';
  mimeType: string;
  storageProvider: 'google_drive' | 'local_vault';
  fileSize: number;
  url: string;
}

interface FeedComment {
  id: string;
  text: string;
  createdAt: string;
  author: PublicUser | null;
}

interface FeedPost {
  id: string;
  authorId: string;
  caption: string;
  location: string;
  editedAt: string | null;
  createdAt: string;
  author: PublicUser | null;
  media: FeedMedia[];
  likesCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  comments: FeedComment[];
}

interface StorySummary {
  id: string;
  authorId: string;
  author: PublicUser | null;
  viewedByMe: boolean;
}

interface ActivityEntry {
  id: string;
  summary: string;
  category: string;
  createdAt: string;
}

export function HomeFeedPage() {
  const { user, partner, connection, googleDrive } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Compose modal state
  const [composeOpen, setComposeOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [locationText, setLocationText] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [submittingPost, setSubmittingPost] = useState(false);

  // Per-post interaction state
  const [carouselIdx, setCarouselIdx] = useState<Record<string, number>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('compose') === '1') {
      setComposeOpen(true);
      searchParams.delete('compose');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const loadFeed = async (cursor?: string) => {
    if (!user?.emailVerified) {
      setLoading(false);
      return;
    }
    try {
      const [postsRes, storiesRes, notifRes] = await Promise.all([
        api.get<{ posts: FeedPost[]; nextCursor: string | null }>('/posts/feed', {
          params: cursor ? { cursor } : undefined,
        }),
        api.get<{ stories: StorySummary[] }>('/stories/feed'),
        api.get<{ activities: ActivityEntry[] }>('/notifications/list'),
      ]);
      if (cursor) {
        setPosts((prev) => [...prev, ...postsRes.data.posts]);
      } else {
        setPosts(postsRes.data.posts);
      }
      setNextCursor(postsRes.data.nextCursor);
      setStories(storiesRes.data.stories);
      setActivities(notifRes.data.activities || []);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFeed();
  }, [user?.id, user?.emailVerified]);

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setComposeError('Select at least one photo or video.');
      return;
    }
    setSubmittingPost(true);
    setComposeError(null);
    try {
      const uploadedIds: string[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const uploaded = await uploadMediaFile(file, file.name, {
          onProgress: (pct) => {
            const overall = Math.round(((i + pct / 100) / files.length) * 100);
            setUploadProgress(overall);
          },
        });
        uploadedIds.push(uploaded.id);
      }
      const res = await api.post<{ post: FeedPost }>('/posts/create', {
        caption,
        location: locationText,
        mediaIds: uploadedIds,
      });
      setPosts((prev) => [res.data.post, ...prev]);
      setFiles([]);
      setCaption('');
      setLocationText('');
      setUploadProgress(null);
      setComposeOpen(false);
    } catch (err) {
      setComposeError(extractErrorMessage(err));
    } finally {
      setSubmittingPost(false);
    }
  };

  const handleLike = async (postId: string) => {
    try {
      const res = await api.post<{ liked: boolean; likesCount: number }>(`/posts/${postId}/like`);
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, likedByMe: res.data.liked, likesCount: res.data.likesCount } : p))
      );
    } catch {
      // ignore
    }
  };

  const handleSave = async (postId: string) => {
    try {
      const res = await api.post<{ saved: boolean }>(`/posts/${postId}/save`);
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, savedByMe: res.data.saved } : p)));
    } catch {
      // ignore
    }
  };

  const handleComment = async (e: React.FormEvent, postId: string) => {
    e.preventDefault();
    const text = (commentInputs[postId] || '').trim();
    if (!text) return;
    try {
      const res = await api.post<{ comment: FeedComment }>(`/posts/${postId}/comment`, { text });
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, comments: [...p.comments, res.data.comment] } : p))
      );
      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
    } catch {
      // ignore
    }
  };

  const handleSaveEdit = async (postId: string) => {
    try {
      const res = await api.patch<{ post: FeedPost }>(`/posts/${postId}`, { caption: editingCaption });
      setPosts((prev) => prev.map((p) => (p.id === postId ? res.data.post : p)));
      setEditingPostId(null);
    } catch {
      // ignore
    }
  };

  const handleDeletePost = async (postId: string) => {
    try {
      await api.delete(`/posts/${postId}`);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setOpenMenuId(null);
    } catch {
      // ignore
    }
  };

  const handleShareToChat = async (postId: string) => {
    try {
      await api.post('/messages/send', {
        messageType: 'post_share',
        sharedPostId: postId,
        textContent: 'Shared a post',
      });
      setShareToast('Post shared to your private chat.');
      setTimeout(() => setShareToast(null), 2600);
    } catch {
      // ignore
    }
  };

  // Group active stories by author
  const storyAuthors = Array.from(
    new Map(stories.map((s) => [s.authorId, s])).values()
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid xl:grid-cols-[1fr_320px] gap-8 items-start">
      {/* Center Feed Column */}
      <div className="max-w-xl w-full mx-auto space-y-6">
        {shareToast && (
          <div className="px-4 py-2.5 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-medium">
            {shareToast}
          </div>
        )}

        {/* Stories Strip */}
        <section
          aria-label="Stories"
          className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 flex items-center gap-4 overflow-x-auto"
        >
          <button
            onClick={() => navigate('/stories?create=1')}
            className="flex flex-col items-center gap-1.5 shrink-0 group"
          >
            <div className="w-14 h-14 rounded-full border border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-center bg-zinc-50 dark:bg-zinc-800/50 group-hover:border-rose-500 transition-colors">
              <Plus className="w-5 h-5 text-zinc-600 dark:text-zinc-300" />
            </div>
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Your Story</span>
          </button>

          {storyAuthors.map((story) => (
            <button
              key={story.id}
              onClick={() => navigate(`/stories?author=${story.authorId}`)}
              className="flex flex-col items-center gap-1.5 shrink-0"
            >
              <Avatar
                name={story.author?.displayName || 'Member'}
                avatarMediaId={story.author?.avatarMediaId}
                size="lg"
                ring={!story.viewedByMe}
              />
              <span className="text-xs text-zinc-700 dark:text-zinc-300 max-w-[68px] truncate">
                {story.authorId === user?.id ? 'You' : story.author?.displayName}
              </span>
            </button>
          ))}

          {storyAuthors.length === 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              No active 24-hour stories right now. Share a moment from today.
            </p>
          )}
        </section>

        {/* Compose Quick Bar */}
        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={user?.displayName || 'You'} avatarMediaId={user?.avatarMediaId} size="sm" />
            <button
              onClick={() => setComposeOpen(true)}
              className="text-left text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 truncate"
            >
              Share a photo, carousel, or video memory...
            </button>
          </div>
          <button
            onClick={() => setComposeOpen(true)}
            className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-semibold shrink-0 transition-colors"
          >
            New Post
          </button>
        </div>

        {/* Feed States */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 animate-pulse"
              >
                <div className="h-4 w-36 bg-zinc-200 dark:bg-zinc-800 rounded" />
                <div className="aspect-[4/3] bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 text-center space-y-3">
            <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
            <button
              onClick={() => void loadFeed()}
              className="px-4 py-2 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-medium"
            >
              Retry
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="aspect-[16/9] relative bg-zinc-100 dark:bg-zinc-800">
              <img
                src="/src/assets/images/album_cover_coastal_1795010729632.jpg"
                alt="Quiet coastal balcony overlooking calm sea waters"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent flex items-end p-6">
                <div className="text-white">
                  <p className="font-display text-xl font-semibold">Your private feed is ready</p>
                  <p className="text-xs text-zinc-200 mt-1">
                    Posts shared here are visible strictly to you and your invited partner.
                  </p>
                </div>
              </div>
            </div>
            <div className="p-5 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {partner ? `Connected with ${partner.displayName}` : 'Invite your partner in Settings to begin sharing'}
              </span>
              <button
                onClick={() => setComposeOpen(true)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
              >
                Create First Post
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => {
              const activeIdx = carouselIdx[post.id] || 0;
              const currentMedia = post.media[activeIdx];
              const isOwn = post.authorId === user?.id;

              return (
                <article
                  key={post.id}
                  className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden"
                >
                  {/* Post Header */}
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        name={post.author?.displayName || 'Member'}
                        avatarMediaId={post.author?.avatarMediaId}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm">
                          <span className="font-semibold truncate">{post.author?.displayName || 'Member'}</span>
                          <span className="text-zinc-400">·</span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {isOwn ? 'Yours' : 'Partner'}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          {formatRelativeTime(post.createdAt)}
                          {post.location ? ` · ${post.location}` : ''}
                          {currentMedia
                            ? ` · ${currentMedia.storageProvider === 'google_drive' ? 'Google Drive' : 'Private Vault'}`
                            : ''}
                        </p>
                      </div>
                    </div>

                    {isOwn && (
                      <div className="relative">
                        <button
                          onClick={() => setOpenMenuId(openMenuId === post.id ? null : post.id)}
                          aria-label="Post options"
                          className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {openMenuId === post.id && (
                          <div className="absolute right-0 mt-1 w-40 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg py-1 z-20">
                            <button
                              onClick={() => {
                                setEditingPostId(post.id);
                                setEditingCaption(post.caption);
                                setOpenMenuId(null);
                              }}
                              className="w-full px-3.5 py-2 text-left text-xs flex items-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                            >
                              <Edit3 className="w-3.5 h-3.5" /> Edit caption
                            </button>
                            <button
                              onClick={() => void handleDeletePost(post.id)}
                              className="w-full px-3.5 py-2 text-left text-xs flex items-center gap-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete post
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Media Carousel */}
                  {currentMedia && (
                    <div className="relative bg-zinc-950 aspect-square sm:aspect-[4/3] flex items-center justify-center overflow-hidden">
                      {currentMedia.mediaType === 'video' ? (
                        <video
                          src={currentMedia.url}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <img
                          src={currentMedia.url}
                          alt={post.caption || 'Shared private photo'}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onDoubleClick={() => {
                            if (!post.likedByMe) void handleLike(post.id);
                          }}
                          className="w-full h-full object-cover"
                        />
                      )}

                      {post.media.length > 1 && (
                        <>
                          {activeIdx > 0 && (
                            <button
                              onClick={() =>
                                setCarouselIdx((prev) => ({ ...prev, [post.id]: activeIdx - 1 }))
                              }
                              aria-label="Previous slide"
                              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                          )}
                          {activeIdx < post.media.length - 1 && (
                            <button
                              onClick={() =>
                                setCarouselIdx((prev) => ({ ...prev, [post.id]: activeIdx + 1 }))
                              }
                              aria-label="Next slide"
                              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          )}
                          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                            {post.media.map((m, idx) => (
                              <span
                                key={m.id}
                                className={`w-1.5 h-1.5 rounded-full ${
                                  idx === activeIdx ? 'bg-white' : 'bg-white/40'
                                }`}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Actions & Captions */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => void handleLike(post.id)}
                          aria-label={post.likedByMe ? 'Unlike post' : 'Like post'}
                          className="flex items-center gap-1.5 text-sm font-medium"
                        >
                          <Heart
                            className={`w-5 h-5 transition-colors ${
                              post.likedByMe ? 'fill-rose-600 text-rose-600' : 'text-zinc-700 dark:text-zinc-300'
                            }`}
                          />
                          <span className="tabular-nums text-xs">{post.likesCount}</span>
                        </button>
                        <span className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                          <MessageCircle className="w-5 h-5" />
                          <span className="tabular-nums">{post.comments.length}</span>
                        </span>
                        <button
                          onClick={() => void handleShareToChat(post.id)}
                          aria-label="Share to private chat"
                          title="Share to private chat"
                          className="text-zinc-700 dark:text-zinc-300 hover:text-rose-600 transition-colors"
                        >
                          <Share2 className="w-5 h-5" />
                        </button>
                      </div>

                      <button
                        onClick={() => void handleSave(post.id)}
                        aria-label={post.savedByMe ? 'Unsave post' : 'Save post'}
                        className="text-zinc-700 dark:text-zinc-300"
                      >
                        <Bookmark className={`w-5 h-5 ${post.savedByMe ? 'fill-current text-zinc-900 dark:text-zinc-100' : ''}`} />
                      </button>
                    </div>

                    {editingPostId === post.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingCaption}
                          onChange={(e) => setEditingCaption(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void handleSaveEdit(post.id)}
                            className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-medium"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingPostId(null)}
                            className="px-3 py-1.5 rounded-lg text-xs text-zinc-500"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      post.caption && (
                        <p className="text-sm leading-relaxed">
                          <span className="font-semibold mr-2">{post.author?.username}</span>
                          <span>{post.caption}</span>
                          {post.editedAt && (
                            <span className="text-[11px] text-zinc-400 ml-1.5">(edited)</span>
                          )}
                        </p>
                      )
                    )}

                    {/* Comments */}
                    {post.comments.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-zinc-100 dark:border-zinc-800/80">
                        {post.comments.map((c) => (
                          <p key={c.id} className="text-xs leading-relaxed">
                            <span className="font-semibold mr-1.5">{c.author?.username || 'member'}</span>
                            <span className="text-zinc-700 dark:text-zinc-300">{c.text}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    <form onSubmit={(e) => void handleComment(e, post.id)} className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={commentInputs[post.id] || ''}
                        onChange={(e) => setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))}
                        placeholder="Add a private comment..."
                        className="flex-1 bg-transparent text-xs py-1.5 focus:outline-none border-b border-transparent focus:border-zinc-300 dark:focus:border-zinc-700"
                      />
                      <button
                        type="submit"
                        aria-label="Send comment"
                        className="p-1.5 text-rose-600 dark:text-rose-400 hover:opacity-80"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}

            {nextCursor && (
              <div className="text-center">
                <button
                  onClick={() => void loadFeed(nextCursor)}
                  className="px-5 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Load Older Posts
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Activity & Private Connection Panel (Desktop XL) */}
      <aside className="hidden xl:block space-y-5 sticky top-6">
        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Private Connection</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {connection?.status === 'connected' ? '2 / 2 Active' : '1 / 2 Active'}
            </span>
          </div>

          {partner ? (
            <div className="flex items-center gap-3">
              <Avatar
                name={partner.displayName}
                avatarMediaId={partner.avatarMediaId}
                size="md"
                online={partner.online}
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{partner.displayName}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  @{partner.username} · {partner.online ? 'Active now' : 'Offline'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {user?.role === 'owner'
                  ? 'Invite your partner or close friend to unlock shared messaging, albums, and calls.'
                  : 'Waiting for connection setup.'}
              </p>
              {user?.role === 'owner' && (
                <Link
                  to="/settings"
                  className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Create Partner Invite
                </Link>
              )}
            </div>
          )}

          {connection?.connectedAt && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              {connection.relationshipTitle} · Connected {new Date(connection.connectedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-zinc-500" /> Personal Drive
            </h2>
            <Link to="/settings" className="text-xs text-rose-600 dark:text-rose-400 hover:underline">
              Manage
            </Link>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {googleDrive.connected
              ? `Connected (${googleDrive.googleEmail}) · Used ${formatBytes(googleDrive.lastQuotaBytesUsed)}`
              : 'Not linked yet. Uploads stay in your private server vault until Google Drive is connected.'}
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
          <h2 className="text-sm font-semibold">Recent Activity</h2>
          {activities.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">No recorded activity yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {activities.slice(0, 6).map((act) => (
                <li key={act.id} className="text-xs text-zinc-600 dark:text-zinc-400 flex items-baseline justify-between gap-2">
                  <span className="truncate">{act.summary}</span>
                  <span className="text-[11px] text-zinc-400 shrink-0">{formatRelativeTime(act.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Create Post Modal */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="text-base font-semibold">Create Private Post</h2>
              <button
                onClick={() => setComposeOpen(false)}
                aria-label="Close composer"
                className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreatePost} className="p-5 space-y-4">
              {composeError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
                  {composeError}
                </div>
              )}

              <label className="block border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-6 text-center cursor-pointer hover:border-rose-500 transition-colors">
                <ImagePlus className="w-7 h-7 mx-auto text-zinc-400 mb-2" />
                <p className="text-sm font-medium">
                  {files.length > 0 ? `${files.length} file(s) selected` : 'Select photos or videos (up to 10)'}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Stored privately in {googleDrive.connected ? 'your Google Drive' : 'your private vault'} · Max 50 MB/file
                </p>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 10))}
                />
              </label>

              <div>
                <label className="block text-xs font-medium mb-1">Caption</label>
                <textarea
                  rows={3}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Write a note for this memory..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Location (optional)</label>
                <input
                  type="text"
                  value={locationText}
                  onChange={(e) => setLocationText(e.target.value)}
                  placeholder="Amalfi Coast, Home Kitchen..."
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              </div>

              {uploadProgress !== null && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-zinc-500 tabular-nums">
                    <span>Uploading media...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-rose-600 transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm text-zinc-600 dark:text-zinc-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPost || files.length === 0}
                  className="px-5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-sm font-semibold disabled:opacity-50"
                >
                  {submittingPost ? 'Sharing...' : 'Share Post'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
