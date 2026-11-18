import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, ChevronLeft, ChevronRight, Eye, Plus, Send, Sparkles, Trash2, Type, X } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { type PublicUser, useAuth } from '../context/AuthContext';
import { api, extractErrorMessage, formatRelativeTime, uploadMediaFile } from '../lib/api';

interface StoryItem {
  id: string;
  authorId: string;
  storyType: 'photo' | 'video' | 'text';
  mediaUrl: string | null;
  mimeType: string | null;
  textContent: string;
  backgroundStyle: string;
  caption: string;
  overlaySticker: string | null;
  expiresAt: string;
  createdAt: string;
  author: PublicUser | null;
  reactions: { userId: string; emoji: string }[];
  viewerProfiles: { userId: string; displayName: string; viewedAt: string }[];
}

const BACKGROUNDS = [
  'linear-gradient(135deg, #18181b 0%, #3f3f46 100%)',
  'linear-gradient(135deg, #881337 0%, #e11d48 100%)',
  'linear-gradient(135deg, #1e293b 0%, #0f766e 100%)',
  'linear-gradient(135deg, #4338ca 0%, #0f172a 100%)',
];

export function StoriesPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<'active' | 'archive'>('active');
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [archive, setArchive] = useState<StoryItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [replySent, setReplySent] = useState(false);

  // Create story modal
  const [createOpen, setCreateOpen] = useState(searchParams.get('create') === '1');
  const [storyType, setStoryType] = useState<'photo' | 'video' | 'text'>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState('');
  const [backgroundStyle, setBackgroundStyle] = useState(BACKGROUNDS[0]);
  const [caption, setCaption] = useState('');
  const [overlaySticker, setOverlaySticker] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStories = async () => {
    setLoading(true);
    try {
      const [activeRes, archiveRes] = await Promise.all([
        api.get<{ stories: StoryItem[] }>('/stories/feed'),
        api.get<{ stories: StoryItem[] }>('/stories/archive'),
      ]);
      setStories(activeRes.data.stories);
      setArchive(archiveRes.data.stories);

      const authorParam = searchParams.get('author');
      if (authorParam) {
        const idx = activeRes.data.stories.findIndex((s) => s.authorId === authorParam);
        if (idx >= 0) setCurrentIdx(idx);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStories();
  }, []);

  const currentStory = tab === 'active' ? stories[currentIdx] : undefined;

  useEffect(() => {
    if (tab === 'active' && currentStory) {
      void api.post(`/stories/${currentStory.id}/view`).catch(() => {});
    }
  }, [tab, currentStory?.id]);

  const handleCreateStory = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      let mediaId: string | null = null;
      let resolvedType = storyType;
      if (storyType !== 'text') {
        if (!file) {
          setError('Select a photo or video file.');
          setSubmitting(false);
          return;
        }
        resolvedType = file.type.startsWith('video/') ? 'video' : 'photo';
        const uploaded = await uploadMediaFile(file, file.name);
        mediaId = uploaded.id;
      }

      await api.post('/stories/create', {
        storyType: resolvedType,
        mediaId,
        textContent,
        backgroundStyle,
        caption,
        overlaySticker: overlaySticker || null,
      });
      setCreateOpen(false);
      setFile(null);
      setTextContent('');
      setCaption('');
      setOverlaySticker('');
      await loadStories();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReact = async (emoji: string) => {
    if (!currentStory) return;
    const res = await api.post<{ story: StoryItem }>(`/stories/${currentStory.id}/react`, { emoji });
    setStories((prev) => prev.map((s) => (s.id === currentStory.id ? res.data.story : s)));
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentStory || !replyText.trim()) return;
    await api.post(`/stories/${currentStory.id}/reply`, { text: replyText });
    setReplyText('');
    setReplySent(true);
    setTimeout(() => setReplySent(false), 2200);
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/stories/${id}`);
    setCurrentIdx(0);
    await loadStories();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Stories</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Active stories automatically expire after 24 hours. Your own past stories remain in your private archive.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => setTab('active')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === 'active'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500'
              }`}
            >
              Active ({stories.length})
            </button>
            <button
              onClick={() => setTab('archive')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                tab === 'archive'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500'
              }`}
            >
              <Archive className="w-3.5 h-3.5" /> Archive ({archive.length})
            </button>
          </div>

          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" /> Add Story
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-[520px] rounded-2xl bg-zinc-200 dark:bg-zinc-900 animate-pulse" />
      ) : tab === 'active' ? (
        stories.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-12 text-center space-y-3">
            <Sparkles className="w-8 h-8 text-zinc-400 mx-auto" />
            <h2 className="text-base font-semibold">No active 24-hour stories</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Share a photo, video, or text note that disappears from the feed after 24 hours.
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              className="px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
            >
              Create Story
            </button>
          </div>
        ) : (
          currentStory && (
            <div className="max-w-md mx-auto">
              <div className="relative aspect-[9/16] rounded-3xl overflow-hidden bg-zinc-950 text-white border border-zinc-800 shadow-xl flex flex-col justify-between">
                {/* Media or Text Layer */}
                {currentStory.storyType === 'text' ? (
                  <div
                    className="absolute inset-0 flex items-center justify-center p-8 text-center"
                    style={{ background: currentStory.backgroundStyle }}
                  >
                    <p className="font-display text-2xl font-medium leading-relaxed">{currentStory.textContent}</p>
                  </div>
                ) : currentStory.storyType === 'video' && currentStory.mediaUrl ? (
                  <video
                    src={currentStory.mediaUrl}
                    autoPlay
                    loop
                    playsInline
                    controls
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : currentStory.mediaUrl ? (
                  <img
                    src={currentStory.mediaUrl}
                    alt={currentStory.caption || 'Story'}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : null}

                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/75 pointer-events-none" />

                {/* Top Progress & Author */}
                <div className="relative z-10 p-4 space-y-3">
                  <div className="flex gap-1">
                    {stories.map((s, idx) => (
                      <div key={s.id} className="flex-1 h-1 rounded-full bg-white/30 overflow-hidden">
                        <div className={`h-full bg-white ${idx <= currentIdx ? 'w-full' : 'w-0'}`} />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        name={currentStory.author?.displayName || 'Member'}
                        avatarMediaId={currentStory.author?.avatarMediaId}
                        size="sm"
                      />
                      <div>
                        <p className="text-xs font-semibold">{currentStory.author?.displayName}</p>
                        <p className="text-[11px] text-zinc-300">{formatRelativeTime(currentStory.createdAt)}</p>
                      </div>
                    </div>
                    {currentStory.authorId === user?.id && (
                      <button
                        onClick={() => void handleDelete(currentStory.id)}
                        aria-label="Delete story"
                        className="p-2 rounded-lg bg-black/40 hover:bg-black/60 text-rose-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Overlay Sticker */}
                {currentStory.overlaySticker && (
                  <div className="relative z-10 self-center px-4 py-2 rounded-xl bg-black/50 backdrop-blur-sm text-sm font-medium">
                    {currentStory.overlaySticker}
                  </div>
                )}

                {/* Navigation Tap Zones */}
                <button
                  onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                  disabled={currentIdx === 0}
                  aria-label="Previous story"
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 disabled:opacity-20"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setCurrentIdx((i) => Math.min(stories.length - 1, i + 1))}
                  disabled={currentIdx >= stories.length - 1}
                  aria-label="Next story"
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 disabled:opacity-20"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>

                {/* Bottom Caption, Viewers, Reactions, Reply */}
                <div className="relative z-10 p-4 space-y-3">
                  {currentStory.caption && <p className="text-xs text-zinc-100">{currentStory.caption}</p>}

                  <div className="flex items-center justify-between text-[11px] text-zinc-300">
                    <span className="flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" />
                      Seen by {currentStory.viewerProfiles.map((v) => v.displayName).join(', ') || 'No one yet'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {['❤️', '😍', '🔥', '😂'].map((em) => (
                        <button
                          key={em}
                          onClick={() => void handleReact(em)}
                          className="px-1.5 py-0.5 rounded hover:bg-white/20 text-sm"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>

                  {currentStory.authorId !== user?.id && (
                    <form onSubmit={handleReply} className="flex gap-2">
                      <input
                        type="text"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder={replySent ? 'Sent to private chat!' : 'Reply to story...'}
                        className="flex-1 px-3.5 py-2 rounded-xl bg-black/50 border border-white/20 text-xs placeholder:text-zinc-300"
                      />
                      <button type="submit" aria-label="Send story reply" className="p-2 rounded-xl bg-rose-600">
                        <Send className="w-4 h-4" />
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          )
        )
      ) : (
        /* Archive Grid */
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {archive.length === 0 ? (
            <p className="col-span-full text-sm text-zinc-500">Your story archive is empty.</p>
          ) : (
            archive.map((s) => (
              <div
                key={s.id}
                className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-white"
              >
                {s.storyType === 'text' ? (
                  <div
                    className="w-full h-full flex items-center justify-center p-4 text-center text-sm font-display"
                    style={{ background: s.backgroundStyle }}
                  >
                    {s.textContent}
                  </div>
                ) : s.mediaUrl ? (
                  <img src={s.mediaUrl} alt="Archived story" className="w-full h-full object-cover" />
                ) : null}
                <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/80 to-transparent text-[11px]">
                  {new Date(s.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create Story Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Share 24-Hour Story</h2>
              <button onClick={() => setCreateOpen(false)} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => setStoryType('photo')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${
                  storyType !== 'text' ? 'bg-white dark:bg-zinc-900 shadow-xs' : 'text-zinc-500'
                }`}
              >
                Photo / Video
              </button>
              <button
                type="button"
                onClick={() => setStoryType('text')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 ${
                  storyType === 'text' ? 'bg-white dark:bg-zinc-900 shadow-xs' : 'text-zinc-500'
                }`}
              >
                <Type className="w-3.5 h-3.5" /> Text Card
              </button>
            </div>

            <form onSubmit={handleCreateStory} className="space-y-3.5">
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-xs text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              )}

              {storyType === 'text' ? (
                <>
                  <textarea
                    rows={4}
                    required
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="Write a quick thought for your partner..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Backdrop:</span>
                    {BACKGROUNDS.map((bg) => (
                      <button
                        key={bg}
                        type="button"
                        onClick={() => setBackgroundStyle(bg)}
                        className={`w-7 h-7 rounded-full border-2 ${
                          backgroundStyle === bg ? 'border-rose-500' : 'border-transparent'
                        }`}
                        style={{ background: bg }}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <label className="block border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-5 text-center cursor-pointer">
                  <p className="text-sm font-medium">{file ? file.name : 'Choose photo or short video'}</p>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
              )}

              <input
                type="text"
                value={overlaySticker}
                onChange={(e) => setOverlaySticker(e.target.value)}
                placeholder="Overlay label (e.g. Morning Coffee ☕)"
                className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Caption (optional)"
                className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-xs">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Publishing...' : 'Publish 24h Story'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
