import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { mutateState, readState } from '../db/store.ts';
import type { Conversation, Message, NotificationItem } from '../db/types.ts';
import {
  type AuthenticatedRequest,
  getPartnerForUser,
  requireAuth,
  requireVerifiedEmail,
  sanitizeUser,
} from '../middleware/auth.ts';
import { isUserOnline, publishRealtimeEvent } from '../services/realtime.ts';

export const messagesRouter = express.Router();

const sendMessageSchema = z.object({
  messageType: z.enum(['text', 'photo', 'video', 'voice', 'post_share', 'reel_share']),
  textContent: z.string().max(4000).optional().default(''),
  mediaId: z.string().nullable().optional().default(null),
  sharedPostId: z.string().nullable().optional().default(null),
  sharedReelId: z.string().nullable().optional().default(null),
  replyToMessageId: z.string().nullable().optional().default(null),
});

function getOrCreatePrivateConversation(userId: string, partnerId: string | null): Conversation {
  const state = readState();
  const existing = state.conversations.find((c) => c.participantIds.includes(userId));
  if (existing) return existing;

  const participantIds = partnerId ? [userId, partnerId] : [userId];
  return {
    id: crypto.randomUUID(),
    participantIds,
    lastMessageAt: null,
    createdAt: new Date().toISOString(),
  };
}

function hydrateMessage(msg: Message) {
  const state = readState();
  const media = msg.mediaId ? state.media.find((m) => m.id === msg.mediaId) : null;
  const sharedPost = msg.sharedPostId ? state.posts.find((p) => p.id === msg.sharedPostId) : null;
  const sharedReel = msg.sharedReelId ? state.reels.find((r) => r.id === msg.sharedReelId) : null;
  const replyTarget = msg.replyToMessageId
    ? state.messages.find((m) => m.id === msg.replyToMessageId)
    : null;

  return {
    ...msg,
    mediaUrl: media ? `/api/media/stream/${media.id}` : null,
    mediaMimeType: media?.mimeType || null,
    mediaDurationSeconds: media?.durationSeconds || null,
    sharedPostPreview: sharedPost
      ? {
          id: sharedPost.id,
          caption: sharedPost.caption,
          thumbnailUrl: sharedPost.mediaIds[0] ? `/api/media/stream/${sharedPost.mediaIds[0]}` : null,
        }
      : null,
    sharedReelPreview: sharedReel
      ? {
          id: sharedReel.id,
          caption: sharedReel.caption,
          videoUrl: `/api/media/stream/${sharedReel.mediaId}`,
        }
      : null,
    replyToPreview: replyTarget
      ? {
          id: replyTarget.id,
          senderId: replyTarget.senderId,
          textContent: replyTarget.deletedForAll ? 'Message deleted' : replyTarget.textContent,
          messageType: replyTarget.messageType,
        }
      : null,
  };
}

messagesRouter.get('/conversations', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const partner = getPartnerForUser(user.id);

  const convo = await mutateState((state) => {
    let existing = state.conversations.find((c) => c.participantIds.includes(user.id));
    if (!existing) {
      existing = getOrCreatePrivateConversation(user.id, partner?.id || null);
      state.conversations.push(existing);
    } else if (partner && !existing.participantIds.includes(partner.id)) {
      existing.participantIds.push(partner.id);
    }
    return existing;
  }, ['conversations']);

  const state = readState();
  const convoMessages = state.messages.filter((m) => m.conversationId === convo.id);
  const lastMsg = convoMessages[convoMessages.length - 1] || null;
  const unreadCount = convoMessages.filter(
    (m) => m.senderId !== user.id && !m.readBy.some((r) => r.userId === user.id)
  ).length;

  return res.json({
    conversation: {
      ...convo,
      partner: partner
        ? {
            ...sanitizeUser(partner, false),
            online: partner.privacyPrefs.onlinePresence ? isUserOnline(partner.id) : false,
          }
        : null,
      lastMessage: lastMsg ? hydrateMessage(lastMsg) : null,
      unreadCount,
    },
  });
});

messagesRouter.get('/history', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const state = readState();
  const convo = state.conversations.find((c) => c.participantIds.includes(user.id));
  if (!convo) return res.json({ messages: [], conversationId: null });

  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
  const all = state.messages.filter((m) => m.conversationId === convo.id);
  const sliced = all.slice(-limit).map(hydrateMessage);

  return res.json({
    conversationId: convo.id,
    messages: sliced,
    hasMore: all.length > limit,
  });
});

messagesRouter.post('/send', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid message payload.' });
  }

  const user = req.authUser!;
  const partner = getPartnerForUser(user.id);

  if (parsed.data.mediaId) {
    const media = readState().media.find((m) => m.id === parsed.data.mediaId);
    if (!media || media.ownerId !== user.id) {
      return res.status(403).json({ error: 'You can only send media owned by your account.' });
    }
  }

  if (parsed.data.messageType === 'text' && !parsed.data.textContent.trim()) {
    return res.status(400).json({ error: 'Message text cannot be empty.' });
  }

  const now = new Date().toISOString();

  const outcome = await mutateState((state) => {
    let convo = state.conversations.find((c) => c.participantIds.includes(user.id));
    if (!convo) {
      convo = getOrCreatePrivateConversation(user.id, partner?.id || null);
      state.conversations.push(convo);
    }

    const msg: Message = {
      id: crypto.randomUUID(),
      conversationId: convo.id,
      senderId: user.id,
      messageType: parsed.data.messageType,
      textContent: parsed.data.textContent.trim(),
      mediaId: parsed.data.mediaId,
      sharedPostId: parsed.data.sharedPostId,
      sharedReelId: parsed.data.sharedReelId,
      sharedStoryId: null,
      replyToMessageId: parsed.data.replyToMessageId,
      reactions: [],
      readBy: [{ userId: user.id, readAt: now }],
      deletedForAll: false,
      createdAt: now,
    };

    state.messages.push(msg);
    convo.lastMessageAt = now;

    let notification: NotificationItem | null = null;
    if (partner) {
      notification = {
        id: crypto.randomUUID(),
        recipientId: partner.id,
        actorId: user.id,
        type: 'message',
        title: `New message from ${user.displayName}`,
        body:
          msg.messageType === 'voice'
            ? 'Sent a voice message'
            : msg.messageType === 'photo'
            ? 'Sent a photo'
            : msg.messageType === 'video'
            ? 'Sent a video'
            : msg.textContent.slice(0, 80),
        link: '/messages',
        read: false,
        createdAt: now,
      };
      state.notifications.unshift(notification);
    }

    return { msg, notification };
  }, ['conversations', 'messages', 'notifications']);

  const hydrated = hydrateMessage(outcome.msg);
  void publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'message:new',
    data: hydrated,
  });

  if (outcome.notification && partner) {
    void publishRealtimeEvent({
      channel: 'togetherspace-private',
      event: 'notification:new',
      data: outcome.notification,
      targetUserIds: [partner.id],
    });
  }

  return res.status(201).json({ message: hydrated });
});

messagesRouter.post('/read', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (!user.privacyPrefs.readReceipts) {
    return res.json({ ok: true, readReceiptsDisabled: true });
  }

  const now = new Date().toISOString();
  const updatedIds: string[] = [];

  await mutateState((state) => {
    const convo = state.conversations.find((c) => c.participantIds.includes(user.id));
    if (!convo) return;
    for (const msg of state.messages) {
      if (
        msg.conversationId === convo.id &&
        msg.senderId !== user.id &&
        !msg.readBy.some((r) => r.userId === user.id)
      ) {
        msg.readBy.push({ userId: user.id, readAt: now });
        updatedIds.push(msg.id);
      }
    }
  }, ['messages']);

  if (updatedIds.length > 0) {
    void publishRealtimeEvent({
      channel: 'togetherspace-private',
      event: 'message:read',
      data: { readerId: user.id, messageIds: updatedIds, readAt: now },
    });
  }

  return res.json({ ok: true, markedCount: updatedIds.length });
});

messagesRouter.post('/typing', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const isTyping = Boolean(req.body?.isTyping);
  void publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'typing',
    data: { userId: req.authUser!.id, isTyping, timestamp: new Date().toISOString() },
  });
  return res.json({ ok: true });
});

messagesRouter.post('/:id/react', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.slice(0, 8) : '';
  if (!emoji) return res.status(400).json({ error: 'Emoji reaction is required.' });

  const user = req.authUser!;
  const msgId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const msg = state.messages.find((m) => m.id === msgId);
    if (!msg) return { error: 'Message not found.', status: 404 as const };
    const convo = state.conversations.find((c) => c.id === msg.conversationId);
    if (!convo || !convo.participantIds.includes(user.id)) {
      return { error: 'Not authorized to react to this message.', status: 403 as const };
    }

    const existing = msg.reactions.findIndex((r) => r.userId === user.id && r.emoji === emoji);
    if (existing >= 0) {
      msg.reactions.splice(existing, 1);
    } else {
      msg.reactions = msg.reactions.filter((r) => r.userId !== user.id);
      msg.reactions.push({ userId: user.id, emoji });
    }
    return { msg };
  }, ['messages']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });

  const hydrated = hydrateMessage(outcome.msg);
  void publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'message:reaction',
    data: hydrated,
  });

  return res.json({ message: hydrated });
});

messagesRouter.delete('/:id', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const msgId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const msg = state.messages.find((m) => m.id === msgId);
    if (!msg) return { error: 'Message not found.', status: 404 as const };
    if (msg.senderId !== user.id) {
      return { error: 'You can only delete messages you sent.', status: 403 as const };
    }
    msg.deletedForAll = true;
    msg.textContent = '';
    msg.mediaId = null;
    return { msg };
  }, ['messages']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });

  const hydrated = hydrateMessage(outcome.msg);
  void publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'message:delete',
    data: hydrated,
  });

  return res.json({ message: hydrated });
});
