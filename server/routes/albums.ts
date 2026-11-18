import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { mutateState, readState } from '../db/store.ts';
import type { Album } from '../db/types.ts';
import { type AuthenticatedRequest, requireAuth, requireVerifiedEmail, sanitizeUser } from '../middleware/auth.ts';
import { recordActivity } from '../services/audit.ts';

export const albumsRouter = express.Router();

const createAlbumSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(600).optional().default(''),
  isShared: z.boolean().optional().default(true),
  memoryDate: z.string().max(30).nullable().optional().default(null),
  mediaIds: z.array(z.string()).optional().default([]),
});

function hydrateAlbum(album: Album, currentUserId: string) {
  const state = readState();
  const creator = state.users.find((u) => u.id === album.creatorId);
  const items = album.mediaIds
    .map((id) => state.media.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => {
      const uploader = state.users.find((u) => u.id === m!.ownerId);
      return {
        id: m!.id,
        mediaType: m!.mediaType,
        mimeType: m!.mimeType,
        storageProvider: m!.storageProvider,
        fileSize: m!.fileSize,
        createdAt: m!.createdAt,
        url: `/api/media/stream/${m!.id}`,
        uploaderName: uploader?.displayName || 'Member',
        ownerId: m!.ownerId,
      };
    });

  const coverUrl = album.coverMediaId
    ? `/api/media/stream/${album.coverMediaId}`
    : items[0]?.url || null;

  return {
    ...album,
    creator: creator ? sanitizeUser(creator, creator.id === currentUserId) : null,
    items,
    coverUrl,
    isFavoriteByMe: album.isFavoriteBy.includes(currentUserId),
  };
}

albumsRouter.get('/list', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : '';
  const state = readState();

  let visible = state.albums.filter((a) => a.creatorId === user.id || a.isShared);
  if (q) {
    visible = visible.filter(
      (a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
    );
  }

  visible.sort((a, b) => (b.memoryDate || b.createdAt).localeCompare(a.memoryDate || a.createdAt));

  return res.json({
    albums: visible.map((a) => hydrateAlbum(a, user.id)),
  });
});

albumsRouter.post('/create', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const parsed = createAlbumSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid album details.' });
  }

  const user = req.authUser!;
  const now = new Date().toISOString();
  const album: Album = {
    id: crypto.randomUUID(),
    creatorId: user.id,
    title: parsed.data.title.trim(),
    description: parsed.data.description.trim(),
    coverMediaId: parsed.data.mediaIds[0] || null,
    mediaIds: parsed.data.mediaIds,
    isShared: parsed.data.isShared,
    isFavoriteBy: [],
    memoryDate: parsed.data.memoryDate,
    createdAt: now,
    updatedAt: now,
  };

  await mutateState((state) => {
    state.albums.unshift(album);
  }, ['albums']);

  await recordActivity({
    userId: user.id,
    summary: `Created album "${album.title}"`,
    category: 'album',
  });

  return res.status(201).json({ album: hydrateAlbum(album, user.id) });
});

albumsRouter.get('/:id', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const album = readState().albums.find((a) => a.id === req.params.id);
  if (!album) return res.status(404).json({ error: 'Album not found.' });
  if (album.creatorId !== user.id && !album.isShared) {
    return res.status(403).json({ error: 'This album is private to its creator.' });
  }
  return res.json({ album: hydrateAlbum(album, user.id) });
});

albumsRouter.patch('/:id', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    title: z.string().min(1).max(100).optional(),
    description: z.string().max(600).optional(),
    isShared: z.boolean().optional(),
    memoryDate: z.string().max(30).nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid album update.' });

  const user = req.authUser!;
  const albumId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const album = state.albums.find((a) => a.id === albumId);
    if (!album) return { error: 'Album not found.', status: 404 as const };
    if (album.creatorId !== user.id) {
      return { error: 'Only the album creator can edit album details.', status: 403 as const };
    }
    if (parsed.data.title !== undefined) album.title = parsed.data.title.trim();
    if (parsed.data.description !== undefined) album.description = parsed.data.description.trim();
    if (parsed.data.isShared !== undefined) album.isShared = parsed.data.isShared;
    if (parsed.data.memoryDate !== undefined) album.memoryDate = parsed.data.memoryDate;
    album.updatedAt = new Date().toISOString();
    return { album };
  }, ['albums']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ album: hydrateAlbum(outcome.album, user.id) });
});

albumsRouter.post('/:id/add-media', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const mediaIds = Array.isArray(req.body?.mediaIds) ? (req.body.mediaIds as string[]) : [];
  if (mediaIds.length === 0) return res.status(400).json({ error: 'No media IDs provided.' });

  const user = req.authUser!;
  const albumId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const album = state.albums.find((a) => a.id === albumId);
    if (!album) return { error: 'Album not found.', status: 404 as const };
    if (album.creatorId !== user.id && !album.isShared) {
      return { error: 'Not authorized to add media to this album.', status: 403 as const };
    }
    for (const id of mediaIds) {
      const m = state.media.find((item) => item.id === id);
      if (m && (m.ownerId === user.id || m.allowedViewerIds.includes(user.id))) {
        if (!album.mediaIds.includes(id)) album.mediaIds.push(id);
        if (!m.albumIds.includes(album.id)) m.albumIds.push(album.id);
      }
    }
    if (!album.coverMediaId && album.mediaIds.length > 0) {
      album.coverMediaId = album.mediaIds[0];
    }
    album.updatedAt = new Date().toISOString();
    return { album };
  }, ['albums', 'media']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ album: hydrateAlbum(outcome.album, user.id) });
});

albumsRouter.post('/:id/remove-media', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const mediaId = typeof req.body?.mediaId === 'string' ? req.body.mediaId : '';
  const user = req.authUser!;
  const albumId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const album = state.albums.find((a) => a.id === albumId);
    if (!album) return { error: 'Album not found.', status: 404 as const };
    const media = state.media.find((m) => m.id === mediaId);
    if (album.creatorId !== user.id && media?.ownerId !== user.id) {
      return { error: 'Not authorized to remove this media.', status: 403 as const };
    }
    album.mediaIds = album.mediaIds.filter((id) => id !== mediaId);
    if (album.coverMediaId === mediaId) {
      album.coverMediaId = album.mediaIds[0] || null;
    }
    album.updatedAt = new Date().toISOString();
    return { album };
  }, ['albums']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ album: hydrateAlbum(outcome.album, user.id) });
});

albumsRouter.post('/:id/reorder', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const orderedIds = Array.isArray(req.body?.mediaIds) ? (req.body.mediaIds as string[]) : [];
  const user = req.authUser!;
  const albumId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const album = state.albums.find((a) => a.id === albumId);
    if (!album) return { error: 'Album not found.', status: 404 as const };
    if (album.creatorId !== user.id && !album.isShared) {
      return { error: 'Not authorized to reorder this album.', status: 403 as const };
    }
    const existingSet = new Set(album.mediaIds);
    album.mediaIds = orderedIds.filter((id) => existingSet.has(id));
    album.updatedAt = new Date().toISOString();
    return { album };
  }, ['albums']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ album: hydrateAlbum(outcome.album, user.id) });
});

albumsRouter.post('/:id/favorite', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const albumId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const album = state.albums.find((a) => a.id === albumId);
    if (!album) return { error: 'Album not found.', status: 404 as const };
    if (album.creatorId !== user.id && !album.isShared) return { error: 'Access denied.', status: 403 as const };

    if (album.isFavoriteBy.includes(user.id)) {
      album.isFavoriteBy = album.isFavoriteBy.filter((id) => id !== user.id);
    } else {
      album.isFavoriteBy.push(user.id);
    }
    return { album };
  }, ['albums']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ album: hydrateAlbum(outcome.album, user.id) });
});

albumsRouter.delete('/:id', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const albumId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const album = state.albums.find((a) => a.id === albumId);
    if (!album) return { error: 'Album not found.', status: 404 as const };
    if (album.creatorId !== user.id) {
      return { error: 'Only the album creator can delete this album.', status: 403 as const };
    }
    state.albums = state.albums.filter((a) => a.id !== albumId);
    return { ok: true };
  }, ['albums']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ ok: true });
});
