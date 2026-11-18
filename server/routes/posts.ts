import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { mutateState, readState } from '../db/store.ts';
import type { NotificationItem, Post } from '../db/types.ts';
import {
  type AuthenticatedRequest,
  getPartnerForUser,
  requireAuth,
  requireVerifiedEmail,
  sanitizeUser,
} from '../middleware/auth.ts';
import { recordActivity } from '../services/audit.ts';
import { publishRealtimeEvent } from '../services/realtime.ts';

export const postsRouter = express.Router();

const createPostSchema = z.object({
  caption: z.string().max(2200).optional().default(''),
  location: z.string().max(120).optional().default(''),
  mediaIds: z.array(z.string().min(1)).min(1).max(10),
});

function hydratePost(post: Post, currentUserId: string) {
  const state = readState();
  const author = state.users.find((u) => u.id === post.authorId);
  const mediaList = post.mediaIds
    .map((id) => state.media.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => ({
      id: m!.id,
      mediaType: m!.mediaType,
      mimeType: m!.mimeType,
      storageProvider: m!.storageProvider,
      fileSize: m!.fileSize,
      url: `/api/media/stream/${m!.id}`,
    }));

  const likes = state.likes.filter((l) => l.targetType === 'post' && l.targetId === post.id);
  const comments = state.comments
    .filter((c) => c.targetType === 'post' && c.targetId === post.id)
    .map((c) => {
      const commentAuthor = state.users.find((u) => u.id === c.authorId);
      return {
        ...c,
        author: commentAuthor ? sanitizeUser(commentAuthor, commentAuthor.id === currentUserId) : null,
      };
    });
  const saved = state.savedMedia.some(
    (s) => s.targetType === 'post' && s.targetId === post.id && s.userId === currentUserId
  );

  return {
    ...post,
    author: author ? sanitizeUser(author, author.id === currentUserId) : null,
    media: mediaList,
    likesCount: likes.length,
    likedByMe: likes.some((l) => l.userId === currentUserId),
    savedByMe: saved,
    comments,
  };
}

postsRouter.get('/feed', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const state = readState();
  const limit = Math.min(30, Math.max(1, Number(req.query.limit || 12)));
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const search = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : '';

  let list = [...state.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (search) {
    list = list.filter(
      (p) => p.caption.toLowerCase().includes(search) || p.location.toLowerCase().includes(search)
    );
  }

  if (cursor) {
    const idx = list.findIndex((p) => p.id === cursor);
    if (idx >= 0) list = list.slice(idx + 1);
  }

  const page = list.slice(0, limit);
  const nextCursor = list.length > limit ? page[page.length - 1]?.id || null : null;

  return res.json({
    posts: page.map((p) => hydratePost(p, user.id)),
    nextCursor,
  });
});

postsRouter.post('/create', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid post payload.' });
  }

  const user = req.authUser!;
  const state = readState();

  // Verify ownership of attached media items
  for (const mediaId of parsed.data.mediaIds) {
    const item = state.media.find((m) => m.id === mediaId);
    if (!item || item.ownerId !== user.id) {
      return res.status(403).json({ error: 'You may only attach media uploaded by your own account.' });
    }
  }

  const now = new Date().toISOString();
  const post: Post = {
    id: crypto.randomUUID(),
    authorId: user.id,
    caption: parsed.data.caption.trim(),
    location: parsed.data.location.trim(),
    mediaIds: parsed.data.mediaIds,
    editedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await mutateState((s) => {
    s.posts.unshift(post);
  }, ['posts']);

  await recordActivity({
    userId: user.id,
    summary: `Shared a new ${parsed.data.mediaIds.length > 1 ? 'carousel' : 'post'}`,
    category: 'post',
  });

  return res.status(201).json({ post: hydratePost(post, user.id) });
});

postsRouter.patch('/:id', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    caption: z.string().max(2200),
    location: z.string().max(120).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid post edit.' });
  }

  const user = req.authUser!;
  const postId = String(req.params.id);

  const updated = await mutateState((state) => {
    const post = state.posts.find((p) => p.id === postId);
    if (!post) return { error: 'Post not found.', status: 404 as const };
    if (post.authorId !== user.id) {
      return { error: 'You can only edit your own posts.', status: 403 as const };
    }
    post.caption = parsed.data.caption.trim();
    if (parsed.data.location !== undefined) post.location = parsed.data.location.trim();
    post.editedAt = new Date().toISOString();
    post.updatedAt = post.editedAt;
    return { post };
  }, ['posts']);

  if ('error' in updated) {
    return res.status(updated.status as number).json({ error: updated.error });
  }

  return res.json({ post: hydratePost(updated.post, user.id) });
});

postsRouter.delete('/:id', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const postId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const post = state.posts.find((p) => p.id === postId);
    if (!post) return { error: 'Post not found.', status: 404 as const };
    if (post.authorId !== user.id) {
      return { error: 'You can only delete your own posts.', status: 403 as const };
    }
    state.posts = state.posts.filter((p) => p.id !== postId);
    state.likes = state.likes.filter((l) => !(l.targetType === 'post' && l.targetId === postId));
    state.comments = state.comments.filter((c) => !(c.targetType === 'post' && c.targetId === postId));
    state.savedMedia = state.savedMedia.filter((s) => !(s.targetType === 'post' && s.targetId === postId));
    return { ok: true };
  }, ['posts', 'likes', 'comments', 'savedMedia']);

  if ('error' in outcome) {
    return res.status(outcome.status as number).json({ error: outcome.error });
  }

  return res.json({ ok: true });
});

postsRouter.post('/:id/like', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const postId = String(req.params.id);
  const partner = getPartnerForUser(user.id);

  const outcome = await mutateState((state) => {
    const post = state.posts.find((p) => p.id === postId);
    if (!post) return { error: 'Post not found.', status: 404 as const };

    const existingIdx = state.likes.findIndex(
      (l) => l.targetType === 'post' && l.targetId === postId && l.userId === user.id
    );
    let liked = false;
    let notification: NotificationItem | null = null;

    if (existingIdx >= 0) {
      state.likes.splice(existingIdx, 1);
    } else {
      liked = true;
      state.likes.push({
        id: crypto.randomUUID(),
        targetType: 'post',
        targetId: postId,
        userId: user.id,
        createdAt: new Date().toISOString(),
      });
      if (post.authorId !== user.id && partner) {
        notification = {
          id: crypto.randomUUID(),
          recipientId: post.authorId,
          actorId: user.id,
          type: 'like',
          title: 'Liked your post',
          body: `${user.displayName} liked your post.`,
          link: '/',
          read: false,
          createdAt: new Date().toISOString(),
        };
        state.notifications.unshift(notification);
      }
    }

    const likesCount = state.likes.filter((l) => l.targetType === 'post' && l.targetId === postId).length;
    return { liked, likesCount, notification, authorId: post.authorId };
  }, ['likes', 'notifications']);

  if ('error' in outcome) {
    return res.status(outcome.status as number).json({ error: outcome.error });
  }

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

postsRouter.post('/:id/save', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const postId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const post = state.posts.find((p) => p.id === postId);
    if (!post) return { error: 'Post not found.', status: 404 as const };

    const existingIdx = state.savedMedia.findIndex(
      (s) => s.targetType === 'post' && s.targetId === postId && s.userId === user.id
    );
    let saved = false;
    if (existingIdx >= 0) {
      state.savedMedia.splice(existingIdx, 1);
    } else {
      saved = true;
      state.savedMedia.push({
        id: crypto.randomUUID(),
        targetType: 'post',
        targetId: postId,
        userId: user.id,
        createdAt: new Date().toISOString(),
      });
    }
    return { saved };
  }, ['savedMedia']);

  if ('error' in outcome) {
    return res.status(outcome.status as number).json({ error: outcome.error });
  }

  return res.json({ saved: outcome.saved });
});

postsRouter.post('/:id/comment', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({ text: z.string().min(1).max(1000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Comment text is required.' });
  }

  const user = req.authUser!;
  const postId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const post = state.posts.find((p) => p.id === postId);
    if (!post) return { error: 'Post not found.', status: 404 as const };

    const comment = {
      id: crypto.randomUUID(),
      targetType: 'post' as const,
      targetId: postId,
      authorId: user.id,
      text: parsed.data.text.trim(),
      createdAt: new Date().toISOString(),
    };
    state.comments.push(comment);

    let notification: NotificationItem | null = null;
    if (post.authorId !== user.id) {
      notification = {
        id: crypto.randomUUID(),
        recipientId: post.authorId,
        actorId: user.id,
        type: 'comment',
        title: 'New comment',
        body: `${user.displayName} commented: "${comment.text.slice(0, 60)}"`,
        link: '/',
        read: false,
        createdAt: comment.createdAt,
      };
      state.notifications.unshift(notification);
    }

    return { comment, notification, authorId: post.authorId };
  }, ['comments', 'notifications']);

  if ('error' in outcome) {
    return res.status(outcome.status as number).json({ error: outcome.error });
  }

  if (outcome.notification) {
    void publishRealtimeEvent({
      channel: 'togetherspace-private',
      event: 'notification:new',
      data: outcome.notification,
      targetUserIds: [outcome.authorId],
    });
  }

  return res.status(201).json({
    comment: {
      ...outcome.comment,
      author: sanitizeUser(user, true),
    },
  });
});
