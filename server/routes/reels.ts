import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { mutateState, readState } from '../db/store.ts';
import type { NotificationItem, Reel } from '../db/types.ts';
import { type AuthenticatedRequest, requireAuth, requireVerifiedEmail, sanitizeUser } from '../middleware/auth.ts';
import { recordActivity } from '../services/audit.ts';
import { publishRealtimeEvent } from '../services/realtime.ts';

export const reelsRouter = express.Router();

const uploadReelSchema = z.object({
  mediaId: z.string().min(1),
  coverMediaId: z.string().nullable().optional().default(null),
  caption: z.string().max(1500).optional().default(''),
  audioLabel: z.string().max(100).optional().default('Original Audio'),
});

function hydrateReel(reel: Reel, currentUserId: string) {
  const state = readState();
  const author = state.users.find((u) => u.id === reel.authorId);
  const media = state.media.find((m) => m.id === reel.mediaId);
  const likes = state.likes.filter((l) => l.targetType === 'reel' && l.targetId === reel.id);
  const comments = state.comments
    .filter((c) => c.targetType === 'reel' && c.targetId === reel.id)
    .map((c) => {
      const commentAuthor = state.users.find((u) => u.id === c.authorId);
      return {
        ...c,
        author: commentAuthor ? sanitizeUser(commentAuthor, commentAuthor.id === currentUserId) : null,
      };
    });
  const savedByMe = state.savedMedia.some(
    (s) => s.targetType === 'reel' && s.targetId === reel.id && s.userId === currentUserId
  );

  return {
    ...reel,
    author: author ? sanitizeUser(author, author.id === currentUserId) : null,
    videoUrl: media ? `/api/media/stream/${media.id}` : null,
    coverUrl: reel.coverMediaId ? `/api/media/stream/${reel.coverMediaId}` : null,
    mimeType: media?.mimeType || 'video/mp4',
    likesCount: likes.length,
    likedByMe: likes.some((l) => l.userId === currentUserId),
    savedByMe,
    comments,
  };
}

reelsRouter.get('/feed', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const state = readState();
  const reels = [...state.reels]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => hydrateReel(r, user.id));
  return res.json({ reels });
});

reelsRouter.post('/upload', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const parsed = uploadReelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid reel details.' });
  }

  const user = req.authUser!;
  const media = readState().media.find((m) => m.id === parsed.data.mediaId);
  if (!media || media.ownerId !== user.id || media.mediaType !== 'video') {
    return res.status(403).json({ error: 'Reels require a video uploaded by your account.' });
  }

  const reel: Reel = {
    id: crypto.randomUUID(),
    authorId: user.id,
    mediaId: parsed.data.mediaId,
    coverMediaId: parsed.data.coverMediaId,
    caption: parsed.data.caption.trim(),
    audioLabel: parsed.data.audioLabel.trim() || 'Original Audio',
    watchHistory: [],
    createdAt: new Date().toISOString(),
  };

  await mutateState((state) => {
    state.reels.unshift(reel);
  }, ['reels']);

  await recordActivity({
    userId: user.id,
    summary: 'Uploaded a new reel',
    category: 'reel',
  });

  return res.status(201).json({ reel: hydrateReel(reel, user.id) });
});

reelsRouter.post('/:id/watch', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const reelId = String(req.params.id);

  await mutateState((state) => {
    const reel = state.reels.find((r) => r.id === reelId);
    if (!reel) return;
    reel.watchHistory = reel.watchHistory.filter((w) => w.userId !== user.id);
    reel.watchHistory.unshift({ userId: user.id, watchedAt: new Date().toISOString() });
  }, ['reels']);

  return res.json({ ok: true });
});

reelsRouter.post('/:id/like', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const reelId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const reel = state.reels.find((r) => r.id === reelId);
    if (!reel) return { error: 'Reel not found.', status: 404 as const };

    const idx = state.likes.findIndex(
      (l) => l.targetType === 'reel' && l.targetId === reelId && l.userId === user.id
    );
    let liked = false;
    let notification: NotificationItem | null = null;
    if (idx >= 0) {
      state.likes.splice(idx, 1);
    } else {
      liked = true;
      state.likes.push({
        id: crypto.randomUUID(),
        targetType: 'reel',
        targetId: reelId,
        userId: user.id,
        createdAt: new Date().toISOString(),
      });
      if (reel.authorId !== user.id) {
        notification = {
          id: crypto.randomUUID(),
          recipientId: reel.authorId,
          actorId: user.id,
          type: 'like',
          title: 'Liked your reel',
          body: `${user.displayName} liked your reel.`,
          link: '/reels',
          read: false,
          createdAt: new Date().toISOString(),
        };
        state.notifications.unshift(notification);
      }
    }

    const likesCount = state.likes.filter((l) => l.targetType === 'reel' && l.targetId === reelId).length;
    return { liked, likesCount, notification, authorId: reel.authorId };
  }, ['likes', 'notifications']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });

  if (outcome.notification) {
    void publishRealtimeEvent({
      channel: 'togetherspace-private',
      event: 'notification:new',
      data: outcome.notification,
      targetUserIds: [outcome.authorId],
    });
  }

  return res.json({ liked: outcome.liked, likesCount: outcome.likesCount });
});

reelsRouter.post('/:id/save', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const reelId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const reel = state.reels.find((r) => r.id === reelId);
    if (!reel) return { error: 'Reel not found.', status: 404 as const };
    const idx = state.savedMedia.findIndex(
      (s) => s.targetType === 'reel' && s.targetId === reelId && s.userId === user.id
    );
    let saved = false;
    if (idx >= 0) {
      state.savedMedia.splice(idx, 1);
    } else {
      saved = true;
      state.savedMedia.push({
        id: crypto.randomUUID(),
        targetType: 'reel',
        targetId: reelId,
        userId: user.id,
        createdAt: new Date().toISOString(),
      });
    }
    return { saved };
  }, ['savedMedia']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ saved: outcome.saved });
});

reelsRouter.post('/:id/comment', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ text: z.string().min(1).max(1000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Comment text is required.' });

  const user = req.authUser!;
  const reelId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const reel = state.reels.find((r) => r.id === reelId);
    if (!reel) return { error: 'Reel not found.', status: 404 as const };

    const comment = {
      id: crypto.randomUUID(),
      targetType: 'reel' as const,
      targetId: reelId,
      authorId: user.id,
      text: parsed.data.text.trim(),
      createdAt: new Date().toISOString(),
    };
    state.comments.push(comment);
    return { comment };
  }, ['comments']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.status(201).json({ comment: { ...outcome.comment, author: sanitizeUser(user, true) } });
});

reelsRouter.delete('/:id', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const reelId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const reel = state.reels.find((r) => r.id === reelId);
    if (!reel) return { error: 'Reel not found.', status: 404 as const };
    if (reel.authorId !== user.id) return { error: 'You can only delete your own reels.', status: 403 as const };
    state.reels = state.reels.filter((r) => r.id !== reelId);
    state.likes = state.likes.filter((l) => !(l.targetType === 'reel' && l.targetId === reelId));
    state.comments = state.comments.filter((c) => !(c.targetType === 'reel' && c.targetId === reelId));
    state.savedMedia = state.savedMedia.filter((s) => !(s.targetType === 'reel' && s.targetId === reelId));
    return { ok: true };
  }, ['reels', 'likes', 'comments', 'savedMedia']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ ok: true });
});
