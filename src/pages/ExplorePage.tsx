import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clapperboard, FolderHeart, Image as ImageIcon, Search } from 'lucide-react';
import { api, extractErrorMessage, formatRelativeTime } from '../lib/api';

interface ExplorePost {
  id: string;
  caption: string;
  location: string;
  createdAt: string;
  media: { id: string; mediaType: string; url: string }[];
}

interface ExploreAlbum {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  mediaIds: string[];
}

interface ExploreReel {
  id: string;
  caption: string;
  videoUrl: string | null;
}

export function ExplorePage() {
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<ExplorePost[]>([]);
  const [albums, setAlbums] = useState<ExploreAlbum[]>([]);
  const [reels, setReels] = useState<ExploreReel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (q = '') => {
    setLoading(true);
    try {
      const [pRes, aRes, rRes] = await Promise.all([
        api.get<{ posts: ExplorePost[] }>('/posts/feed', { params: { q, limit: 24 } }),
        api.get<{ albums: ExploreAlbum[] }>('/albums/list', { params: { q } }),
        api.get<{ reels: ExploreReel[] }>('/reels/feed'),
      ]);
      setPosts(pRes.data.posts);
      setAlbums(aRes.data.albums);
      setReels(
        q
          ? rRes.data.reels.filter((r) => r.caption.toLowerCase().includes(q.toLowerCase()))
          : rRes.data.reels
      );
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData('');
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Private Archive Search</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Searches strictly within your shared posts, reels, and albums. Public discovery is disabled.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadData(query);
          }}
          className="relative w-full sm:w-80"
        >
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search captions, locations, albums..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30"
          />
        </form>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="aspect-square rounded-2xl bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : posts.length === 0 && albums.length === 0 && reels.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-10 text-center">
          <p className="text-sm font-medium">No matching private memories found</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Try a different search keyword or share a new post from Home.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {albums.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <FolderHeart className="w-4 h-4 text-zinc-500" /> Albums ({albums.length})
                </h2>
                <Link to="/albums" className="text-xs text-rose-600 dark:text-rose-400 hover:underline">
                  View all albums
                </Link>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                {albums.map((a) => (
                  <Link
                    key={a.id}
                    to="/albums"
                    className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                  >
                    <div className="aspect-[4/3] bg-zinc-100 dark:bg-zinc-800">
                      {a.coverUrl ? (
                        <img src={a.coverUrl} alt={a.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-400">
                          <FolderHeart className="w-8 h-8" />
                        </div>
                      )}
                    </div>
                    <div className="p-3.5">
                      <p className="text-sm font-semibold truncate">{a.title}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums mt-0.5">
                        {a.mediaIds.length} items
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {posts.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-zinc-500" /> Posts ({posts.length})
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {posts.map((p) => {
                  const first = p.media[0];
                  return (
                    <Link
                      key={p.id}
                      to="/"
                      className="group relative aspect-square rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                    >
                      {first?.mediaType === 'video' ? (
                        <video src={first.url} preload="metadata" className="w-full h-full object-cover" />
                      ) : first ? (
                        <img
                          src={first.url}
                          alt={p.caption || 'Shared post'}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                        />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent flex items-end p-3">
                        <div className="text-white text-xs truncate">
                          <p className="font-medium truncate">{p.caption || 'Untitled memory'}</p>
                          <p className="text-[11px] text-zinc-300">{formatRelativeTime(p.createdAt)}</p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {reels.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Clapperboard className="w-4 h-4 text-zinc-500" /> Reels ({reels.length})
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {reels.map((r) => (
                  <Link
                    key={r.id}
                    to="/reels"
                    className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                  >
                    {r.videoUrl && <video src={r.videoUrl} preload="metadata" className="w-full h-full object-cover" />}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-3">
                      <p className="text-xs text-white truncate">{r.caption || 'Reel'}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
