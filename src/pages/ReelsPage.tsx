import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Heart,
  Maximize2,
  MessageCircle,
  Plus,
  Send,
  Share2,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { type PublicUser, useAuth } from '../context/AuthContext';
import { api, extractErrorMessage, uploadMediaFile } from '../lib/api';

interface ReelItem {
  id: string;
  authorId: string;
  caption: string;
  audioLabel: string;
  videoUrl: string | null;
  likesCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  createdAt: string;
  author: PublicUser | null;
  comments: { id: string; text: string; author: PublicUser | null }[];
}

export function ReelsPage() {
  const { user } = useAuth();
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [commentsOpenFor, setCommentsOpenFor] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');

  // Upload reel modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [audioLabel, setAudioLabel] = useState('Original Audio');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    api
      .get<{ reels: ReelItem[] }>('/reels/feed')
      .then((res) => setReels(res.data.reels))
      .finally(() => setLoading(false));
  }, []);

  // Autoplay only active visible reel; pause all others
  useEffect(() => {
    const activeReel = reels[activeIndex];
    for (let i = 0; i < reels.length; i += 1) {
      const r = reels[i];
      const el = videoRefs.current[r.id];
      if (!el) continue;
      if (i === activeIndex) {
        el.play().catch(() => {});
        void api.post(`/reels/${r.id}/watch`).catch(() => {});
      } else {
        el.pause();
      }
    }
    if (!activeReel) return;
  }, [activeIndex, reels]);

  const scrollToReel = (index: number) => {
    const bounded = Math.max(0, Math.min(reels.length - 1, index));
    setActiveIndex(bounded);
    const target = containerRef.current?.children[bounded] as HTMLElement | undefined;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, clientHeight } = containerRef.current;
    if (clientHeight > 0) {
      const idx = Math.round(scrollTop / clientHeight);
      if (idx !== activeIndex && idx >= 0 && idx < reels.length) {
        setActiveIndex(idx);
      }
    }
  };

  const handleUploadReel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const media = await uploadMediaFile(videoFile, videoFile.name, {
        onProgress: setUploadProgress,
      });
      const res = await api.post<{ reel: ReelItem }>('/reels/upload', {
        mediaId: media.id,
        caption,
        audioLabel,
      });
      setReels((prev) => [res.data.reel, ...prev]);
      setActiveIndex(0);
      setUploadOpen(false);
      setVideoFile(null);
      setCaption('');
      setUploadProgress(null);
    } catch (err) {
      setUploadError(extractErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const handleLike = async (id: string) => {
    const res = await api.post<{ liked: boolean; likesCount: number }>(`/reels/${id}/like`);
    setReels((prev) =>
      prev.map((r) => (r.id === id ? { ...r, likedByMe: res.data.liked, likesCount: res.data.likesCount } : r))
    );
  };

  const handleSave = async (id: string) => {
    const res = await api.post<{ saved: boolean }>(`/reels/${id}/save`);
    setReels((prev) => prev.map((r) => (r.id === id ? { ...r, savedByMe: res.data.saved } : r)));
  };

  const handleShare = async (id: string) => {
    await api.post('/messages/send', {
      messageType: 'reel_share',
      sharedReelId: id,
      textContent: 'Shared a reel',
    });
    setToast('Reel shared to private chat');
    setTimeout(() => setToast(null), 2400);
  };

  const handleCommentSubmit = async (e: React.FormEvent, reelId: string) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    const res = await api.post<{ comment: { id: string; text: string; author: PublicUser | null } }>(
      `/reels/${reelId}/comment`,
      { text: commentText }
    );
    setReels((prev) =>
      prev.map((r) => (r.id === reelId ? { ...r, comments: [...r.comments, res.data.comment] } : r))
    );
    setCommentText('');
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/reels/${id}`);
    setReels((prev) => prev.filter((r) => r.id !== id));
    setActiveIndex(0);
  };

  return (
    <div className="relative h-[calc(100vh-7rem)] lg:h-screen bg-zinc-950 text-white flex flex-col items-center justify-center overflow-hidden">
      {/* Top Floating Controls */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between max-w-2xl mx-auto">
        <span className="font-display text-lg font-semibold">Reels</span>
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" /> Upload Reel
        </button>
      </div>

      {toast && (
        <div className="absolute top-16 z-30 px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-xs">
          {toast}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-400">Loading private reels...</div>
      ) : reels.length === 0 ? (
        <div className="text-center p-8 max-w-sm space-y-4">
          <Clapperboard className="w-10 h-10 text-zinc-500 mx-auto" />
          <h2 className="font-display text-xl font-semibold">No Reels Yet</h2>
          <p className="text-xs text-zinc-400">
            Upload vertical video clips stored privately in your Google Drive or vault. Only you and your partner can
            watch them.
          </p>
          <button
            onClick={() => setUploadOpen(true)}
            className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
          >
            Upload First Reel
          </button>
        </div>
      ) : (
        <div className="relative w-full h-full flex items-center justify-center">
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="w-full max-w-md h-full overflow-y-scroll snap-y snap-mandatory scroll-smooth"
          >
            {reels.map((reel, idx) => (
              <div
                key={reel.id}
                className="relative w-full h-full snap-start flex items-center justify-center bg-black"
              >
                {reel.videoUrl && Math.abs(idx - activeIndex) <= 1 ? (
                  <video
                    ref={(el) => {
                      videoRefs.current[reel.id] = el;
                    }}
                    src={reel.videoUrl}
                    loop
                    muted={muted}
                    playsInline
                    preload="metadata"
                    onDoubleClick={() => {
                      if (!reel.likedByMe) void handleLike(reel.id);
                    }}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-xs text-zinc-500">
                    Buffered standby
                  </div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />

                {/* Bottom Caption Overlay */}
                <div className="absolute bottom-5 left-4 right-16 z-10 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar
                      name={reel.author?.displayName || 'Member'}
                      avatarMediaId={reel.author?.avatarMediaId}
                      size="sm"
                    />
                    <span className="text-sm font-semibold">{reel.author?.displayName}</span>
                  </div>
                  {reel.caption && <p className="text-xs text-zinc-100 leading-relaxed">{reel.caption}</p>}
                  <p className="text-[11px] text-zinc-300">{reel.audioLabel}</p>
                </div>

                {/* Right Action Column */}
                <div className="absolute bottom-6 right-3 z-10 flex flex-col items-center gap-4">
                  <button
                    onClick={() => void handleLike(reel.id)}
                    aria-label="Like reel"
                    className="flex flex-col items-center gap-1"
                  >
                    <Heart className={`w-6 h-6 ${reel.likedByMe ? 'fill-rose-500 text-rose-500' : 'text-white'}`} />
                    <span className="text-[11px] tabular-nums">{reel.likesCount}</span>
                  </button>

                  <button
                    onClick={() => setCommentsOpenFor(reel.id)}
                    aria-label="Reel comments"
                    className="flex flex-col items-center gap-1"
                  >
                    <MessageCircle className="w-6 h-6" />
                    <span className="text-[11px] tabular-nums">{reel.comments.length}</span>
                  </button>

                  <button onClick={() => void handleSave(reel.id)} aria-label="Save reel">
                    <Bookmark className={`w-6 h-6 ${reel.savedByMe ? 'fill-white' : ''}`} />
                  </button>

                  <button onClick={() => void handleShare(reel.id)} aria-label="Share reel to chat">
                    <Share2 className="w-6 h-6" />
                  </button>

                  <button onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'}>
                    {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>

                  <button
                    onClick={() => videoRefs.current[reel.id]?.requestFullscreen?.()}
                    aria-label="Fullscreen reel"
                  >
                    <Maximize2 className="w-5 h-5" />
                  </button>

                  {reel.authorId === user?.id && (
                    <button
                      onClick={() => void handleDelete(reel.id)}
                      aria-label="Delete reel"
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Prev / Next Controls */}
          <div className="hidden sm:flex flex-col gap-2 ml-4">
            <button
              onClick={() => scrollToReel(activeIndex - 1)}
              disabled={activeIndex === 0}
              aria-label="Previous reel"
              className="p-2.5 rounded-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-30"
            >
              <ChevronUp className="w-5 h-5" />
            </button>
            <button
              onClick={() => scrollToReel(activeIndex + 1)}
              disabled={activeIndex >= reels.length - 1}
              aria-label="Next reel"
              className="p-2.5 rounded-full bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-30"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Reel Comments Drawer */}
      {commentsOpenFor && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4"
          onClick={() => setCommentsOpenFor(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4 max-h-[75vh] flex flex-col"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Reel Comments</h3>
              <button onClick={() => setCommentsOpenFor(null)} aria-label="Close comments">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2.5">
              {reels
                .find((r) => r.id === commentsOpenFor)
                ?.comments.map((c) => (
                  <p key={c.id} className="text-xs">
                    <span className="font-semibold mr-1.5">{c.author?.username}</span>
                    <span className="text-zinc-300">{c.text}</span>
                  </p>
                ))}
            </div>
            <form onSubmit={(e) => void handleCommentSubmit(e, commentsOpenFor)} className="flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs"
              />
              <button type="submit" className="p-2 rounded-xl bg-rose-600 text-white">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Upload Reel Modal */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Upload Private Reel</h3>
              <button onClick={() => setUploadOpen(false)} aria-label="Close modal">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUploadReel} className="space-y-3.5">
              {uploadError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-xs text-rose-700 dark:text-rose-300">
                  {uploadError}
                </div>
              )}
              <label className="block border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-5 text-center cursor-pointer">
                <p className="text-sm font-medium">{videoFile ? videoFile.name : 'Choose MP4 or WebM video'}</p>
                <p className="text-xs text-zinc-500 mt-1">Max 50 MB · Buffered Range playback enabled</p>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                />
              </label>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Caption..."
                className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />
              <input
                type="text"
                value={audioLabel}
                onChange={(e) => setAudioLabel(e.target.value)}
                placeholder="Audio label"
                className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
              />
              {uploadProgress !== null && (
                <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-rose-600" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setUploadOpen(false)} className="px-4 py-2 text-xs">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!videoFile || uploading}
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Publish Reel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
