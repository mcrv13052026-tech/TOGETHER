import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  ChevronLeft,
  ChevronRight,
  FolderHeart,
  ImagePlus,
  LayoutGrid,
  Play,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, extractErrorMessage, uploadMediaFile } from '../lib/api';

interface AlbumMediaItem {
  id: string;
  mediaType: 'photo' | 'video' | 'audio';
  url: string;
  uploaderName: string;
  ownerId: string;
  createdAt: string;
}

interface AlbumData {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  isShared: boolean;
  memoryDate: string | null;
  coverUrl: string | null;
  items: AlbumMediaItem[];
  isFavoriteByMe: boolean;
  createdAt: string;
}

export function AlbumsPage() {
  const { user } = useAuth();
  const [albums, setAlbums] = useState<AlbumData[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('grid');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumData | null>(null);
  const [slideshowIndex, setSlideshowIndex] = useState<number | null>(null);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [memoryDate, setMemoryDate] = useState('');
  const [isShared, setIsShared] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAlbums = async (q = '') => {
    setLoading(true);
    try {
      const res = await api.get<{ albums: AlbumData[] }>('/albums/list', { params: { q } });
      setAlbums(res.data.albums);
      if (selectedAlbum) {
        const refreshed = res.data.albums.find((a) => a.id === selectedAlbum.id) || null;
        setSelectedAlbum(refreshed);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAlbums();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<{ album: AlbumData }>('/albums/create', {
        title,
        description,
        memoryDate: memoryDate || null,
        isShared,
      });
      setAlbums((prev) => [res.data.album, ...prev]);
      setCreateOpen(false);
      setTitle('');
      setDescription('');
      setMemoryDate('');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleFavorite = async (id: string) => {
    const res = await api.post<{ album: AlbumData }>(`/albums/${id}/favorite`);
    setAlbums((prev) => prev.map((a) => (a.id === id ? res.data.album : a)));
    if (selectedAlbum?.id === id) setSelectedAlbum(res.data.album);
  };

  const handleAddFiles = async (albumId: string, fileList: FileList) => {
    const uploadedIds: string[] = [];
    for (const f of Array.from(fileList)) {
      const uploaded = await uploadMediaFile(f, f.name);
      uploadedIds.push(uploaded.id);
    }
    const res = await api.post<{ album: AlbumData }>(`/albums/${albumId}/add-media`, { mediaIds: uploadedIds });
    setAlbums((prev) => prev.map((a) => (a.id === albumId ? res.data.album : a)));
    setSelectedAlbum(res.data.album);
  };

  const handleRemoveMedia = async (albumId: string, mediaId: string) => {
    const res = await api.post<{ album: AlbumData }>(`/albums/${albumId}/remove-media`, { mediaId });
    setAlbums((prev) => prev.map((a) => (a.id === albumId ? res.data.album : a)));
    setSelectedAlbum(res.data.album);
  };

  const handleReorder = async (album: AlbumData, index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= album.items.length) return;
    const ids = album.items.map((i) => i.id);
    [ids[index], ids[targetIdx]] = [ids[targetIdx], ids[index]];
    const res = await api.post<{ album: AlbumData }>(`/albums/${album.id}/reorder`, { mediaIds: ids });
    setAlbums((prev) => prev.map((a) => (a.id === album.id ? res.data.album : a)));
    setSelectedAlbum(res.data.album);
  };

  const handleDeleteAlbum = async (albumId: string) => {
    await api.delete(`/albums/${albumId}`);
    setAlbums((prev) => prev.filter((a) => a.id !== albumId));
    setSelectedAlbum(null);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Albums & Memories</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Organize shared trips, milestones, and timeline memories.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadAlbums(search);
            }}
            className="relative"
          >
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search albums..."
              className="pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs"
            />
          </form>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 ${
                viewMode === 'grid' ? 'bg-white dark:bg-zinc-800 shadow-xs' : 'text-zinc-500'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Grid
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 ${
                viewMode === 'timeline' ? 'bg-white dark:bg-zinc-800 shadow-xs' : 'text-zinc-500'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" /> Timeline
            </button>
          </div>

          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" /> New Album
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="aspect-[4/3] rounded-2xl bg-zinc-200 dark:bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : albums.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden grid md:grid-cols-2 items-stretch">
          <img
            src="/src/assets/images/album_cover_evening_1795010729982.jpg"
            alt="Evening reading table with warm lamp"
            referrerPolicy="no-referrer"
            className="w-full h-56 md:h-full object-cover"
          />
          <div className="p-8 flex flex-col justify-center space-y-3">
            <FolderHeart className="w-7 h-7 text-rose-600" />
            <h2 className="font-display text-xl font-semibold">Start your shared memory archive</h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Group photos and videos by trip, anniversary, or everyday moments. Each upload attributes its owner and
              stays in their Google Drive or private vault.
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              className="self-start px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold"
            >
              Create First Album
            </button>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {albums.map((album) => (
            <div
              key={album.id}
              onClick={() => setSelectedAlbum(album)}
              className="group cursor-pointer rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
            >
              <div className="relative aspect-[4/3] bg-zinc-100 dark:bg-zinc-800">
                {album.coverUrl ? (
                  <img
                    src={album.coverUrl}
                    alt={album.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-400">
                    <FolderHeart className="w-8 h-8" />
                  </div>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleFavorite(album.id);
                  }}
                  aria-label="Favorite album"
                  className="absolute top-3 right-3 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
                >
                  <Star className={`w-4 h-4 ${album.isFavoriteByMe ? 'fill-amber-400 text-amber-400' : ''}`} />
                </button>
              </div>
              <div className="p-4">
                <h3 className="text-sm font-semibold truncate">{album.title}</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 tabular-nums">
                  {album.items.length} items · {album.isShared ? 'Shared' : 'Private'}
                  {album.memoryDate ? ` · ${album.memoryDate}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Relationship Timeline View */
        <div className="space-y-4">
          {albums.map((album) => (
            <div
              key={album.id}
              onClick={() => setSelectedAlbum(album)}
              className="cursor-pointer rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4"
            >
              <div className="w-full sm:w-40 aspect-[4/3] rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0">
                {album.coverUrl ? (
                  <img src={album.coverUrl} alt={album.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-400">
                    <FolderHeart className="w-6 h-6" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                  {album.memoryDate || new Date(album.createdAt).toLocaleDateString()}
                </p>
                <h3 className="font-display text-lg font-semibold mt-0.5">{album.title}</h3>
                {album.description && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 line-clamp-2">{album.description}</p>
                )}
                <p className="text-xs text-zinc-500 mt-2 tabular-nums">
                  {album.items.length} memories · {album.isShared ? 'Shared album' : 'Personal album'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected Album Detail Modal */}
      {selectedAlbum && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold">{selectedAlbum.title}</h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {selectedAlbum.description || 'Private album'} · {selectedAlbum.items.length} items
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedAlbum.items.length > 0 && (
                  <button
                    onClick={() => setSlideshowIndex(0)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-medium"
                  >
                    <Play className="w-3.5 h-3.5" /> Slideshow
                  </button>
                )}
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold cursor-pointer">
                  <ImagePlus className="w-3.5 h-3.5" /> Add Media
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) void handleAddFiles(selectedAlbum.id, e.target.files);
                    }}
                  />
                </label>
                {selectedAlbum.creatorId === user?.id && (
                  <button
                    onClick={() => void handleDeleteAlbum(selectedAlbum.id)}
                    aria-label="Delete album"
                    className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setSelectedAlbum(null)}
                  aria-label="Close album"
                  className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {selectedAlbum.items.length === 0 ? (
                <p className="text-center py-12 text-sm text-zinc-500">
                  No photos or videos in this album yet. Click &ldquo;Add Media&rdquo; to upload.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {selectedAlbum.items.map((item, idx) => (
                    <div
                      key={item.id}
                      className="group relative aspect-square rounded-xl overflow-hidden bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                    >
                      {item.mediaType === 'video' ? (
                        <video
                          src={item.url}
                          onClick={() => setSlideshowIndex(idx)}
                          className="w-full h-full object-cover cursor-pointer"
                        />
                      ) : (
                        <img
                          src={item.url}
                          alt="Album memory"
                          onClick={() => setSlideshowIndex(idx)}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover cursor-pointer"
                        />
                      )}
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between text-white text-[11px]">
                        <span className="truncate">By {item.uploaderName}</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => void handleReorder(selectedAlbum, idx, -1)}
                            disabled={idx === 0}
                            aria-label="Move earlier"
                            className="p-1 hover:bg-white/20 rounded disabled:opacity-30"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => void handleReorder(selectedAlbum, idx, 1)}
                            disabled={idx === selectedAlbum.items.length - 1}
                            aria-label="Move later"
                            className="p-1 hover:bg-white/20 rounded disabled:opacity-30"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          {(selectedAlbum.creatorId === user?.id || item.ownerId === user?.id) && (
                            <button
                              onClick={() => void handleRemoveMedia(selectedAlbum.id, item.id)}
                              aria-label="Remove from album"
                              className="p-1 hover:bg-rose-600/80 rounded"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Slideshow Lightbox */}
      {selectedAlbum && slideshowIndex !== null && selectedAlbum.items[slideshowIndex] && (
        <div className="fixed inset-0 z-[60] bg-black/95 text-white flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-300 tabular-nums">
              {selectedAlbum.title} · {slideshowIndex + 1} / {selectedAlbum.items.length} · Uploaded by{' '}
              {selectedAlbum.items[slideshowIndex].uploaderName}
            </span>
            <button onClick={() => setSlideshowIndex(null)} aria-label="Close slideshow" className="p-2">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center relative max-h-[80vh]">
            {selectedAlbum.items[slideshowIndex].mediaType === 'video' ? (
              <video
                src={selectedAlbum.items[slideshowIndex].url}
                controls
                autoPlay
                className="max-h-full max-w-full rounded-xl"
              />
            ) : (
              <img
                src={selectedAlbum.items[slideshowIndex].url}
                alt="Slideshow frame"
                className="max-h-full max-w-full object-contain rounded-xl"
              />
            )}
            <button
              onClick={() => setSlideshowIndex((i) => Math.max(0, (i || 0) - 1))}
              disabled={slideshowIndex === 0}
              aria-label="Previous"
              className="absolute left-3 p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setSlideshowIndex((i) => Math.min(selectedAlbum.items.length - 1, (i || 0) + 1))}
              disabled={slideshowIndex >= selectedAlbum.items.length - 1}
              aria-label="Next"
              className="absolute right-3 p-3 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div />
        </div>
      )}

      {/* Create Album Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Create Private Album</h2>
              <button onClick={() => setCreateOpen(false)} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3.5">
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-xs text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium mb-1">Album Name</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Autumn Weekend in Kyoto"
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Notes about this memory..."
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Memory Date (optional)</label>
                <input
                  type="date"
                  value={memoryDate}
                  onChange={(e) => setMemoryDate(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={isShared}
                  onChange={(e) => setIsShared(e.target.checked)}
                  className="rounded border-zinc-300"
                />
                <span>Share this album with your connected partner</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-xs">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Album'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
