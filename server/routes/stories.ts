import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { mutateState, readState } from '../db/store.ts';
import type { Message, NotificationItem, Story } from '../db/types.ts';
import { type AuthenticatedRequest, requireAuth, requireVerifiedEmail, sanitizeUser } from '../middleware/auth.ts';
import { recordActivity } from '../services/audit.ts';
import { publishRealtimeEvent } from '../services/realtime.ts';

export const storiesRouter = express.Router();

const createStorySchema = z.object({
  storyType: z.enum(['photo', 'video', 'text']),
  mediaId: z.string().nullable().optional().default(null),
  textContent: z.string().max(500).optional().default(''),
  backgroundStyle: z.string().max(120).optional().default('linear-gradient(135deg, #18181b 0%, #3f3f46 100%)'),
  caption: z.string().max(400).optional().default(''),
  overlaySticker: z.string().max(40).nullable().optional().default(null),
});

export function isStoryExpired(story: Story, now = Date.now()): boolean {
  return new Date(story.expiresAt).getTime() <= now;
}

function hydrateStory(story: Story, currentUserId: string) {
  const state = readState();
  const author = state.users.find((u) => u.id === story.authorId);
  const media = story.mediaId ? state.media.find((m) => m.id === story.mediaId) : null;

  return {
    ...story,
    author: author ? sanitizeUser(author, author.id === currentUserId) : null,
    mediaUrl: media ? `/api/media/stream/${media.id}` : null,
    mimeType: media?.mimeType || null,
    viewedByMe: story.viewers.some((v) => v.userId === currentUserId),
    viewerProfiles: story.viewers.map((v) => {
      const u = state.users.find((usr) => usr.id === v.userId);
      return {
        userId: v.userId,
        viewedAt: v.viewedAt,
        displayName: u?.displayName || 'Member',
        username: u?.username || '',
      };
    }),
  };
}

storiesRouter.get('/feed', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const now = Date.now();
  const activeStories = readState()
    .stories.filter((s) => !isStoryExpired(s, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((s) => hydrateStory(s, user.id));

  return res.json({ stories: activeStories });
});

storiesRouter.get('/archive', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  // Archive returns the authenticated user's own archived/expired stories
  const archivedStories = readState()
    .stories.filter((s) => s.authorId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => hydrateStory(s, user.id));

  return res.json({ stories: archivedStories });
});

storiesRouter.post('/create', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const parsed = createStorySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid story payload.' });
  }

  const user = req.authUser!;
  if (parsed.data.storyType !== 'text') {
    if (!parsed.data.mediaId) {
      return res.status(400).json({ error: 'Photo or video stories require uploaded media.' });
    }
    const media = readState().media.find((m) => m.id === parsed.data.mediaId);
    if (!media || media.ownerId !== user.id) {
      return res.status(403).json({ error: 'You may only attach media owned by your account.' });
    }
  } else if (!parsed.data.textContent.trim()) {
    return res.status(400).json({ error: 'Text stories cannot be empty.' });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const story: Story = {
    id: crypto.randomUUID(),
    authorId: user.id,
    storyType: parsed.data.storyType,
    mediaId: parsed.data.mediaId,
    textContent: parsed.data.textContent.trim(),
    backgroundStyle: parsed.data.backgroundStyle,
    caption: parsed.data.caption.trim(),
    overlaySticker: parsed.data.overlaySticker,
    viewers: [],
    reactions: [],
    expiresAt,
    archived: false,
    createdAt: now.toISOString(),
  };

  await mutateState((state) => {
    state.stories.push(story);
  }, ['stories']);

  await recordActivity({
    userId: user.id,
    summary: 'Posted a 24-hour story',
    category: 'story',
  });

  return res.status(201).json({ story: hydrateStory(story, user.id) });
});

storiesRouter.post('/:id/view', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const storyId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const story = state.stories.find((s) => s.id === storyId);
    if (!story) return { error: 'Story not found.', status: 404 as const };
    if (isStoryExpired(story)) return { error: 'This story has expired.', status: 410 as const };

    if (!story.viewers.some((v) => v.userId === user.id)) {
      story.viewers.push({ userId: user.id, viewedAt: new Date().toISOString() });
    }
    return { story };
  }, ['stories']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ story: hydrateStory(outcome.story, user.id) });
});

storiesRouter.post('/:id/react', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.slice(0, 8) : '';
  if (!emoji) return res.status(400).json({ error: 'Emoji reaction required.' });

  const user = req.authUser!;
  const storyId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const story = state.stories.find((s) => s.id === storyId);
    if (!story) return { error: 'Story not found.', status: 404 as const };
    if (isStoryExpired(story)) return { error: 'This story has expired.', status: 410 as const };

    story.reactions.push({ userId: user.id, emoji, createdAt: new Date().toISOString() });

    let notification: NotificationItem | null = null;
    if (story.authorId !== user.id) {
      notification = {
        id: crypto.randomUUID(),
        recipientId: story.authorId,
        actorId: user.id,
        type: 'story_reaction',
        title: 'Story reaction',
        body: `${user.displayName} reacted ${emoji} to your story.`,
        link: '/stories',
        read: false,
        createdAt: new Date().toISOString(),
      };
      state.notifications.unshift(notification);
    }
    return { story, notification, authorId: story.authorId };
  }, ['stories', 'notifications']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });

  if (outcome.notification) {
    void publishRealtimeEvent({
      channel: 'togetherspace-private',
      event: 'notification:new',
      data: outcome.notification,
      targetUserIds: [outcome.authorId],
    });
  }

  return res.json({ story: hydrateStory(outcome.story, user.id) });
});

storiesRouter.post('/:id/reply', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'Reply message cannot be empty.' });

  const user = req.authUser!;
  const storyId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const story = state.stories.find((s) => s.id === storyId);
    if (!story) return { error: 'Story not found.', status: 404 as const };
    if (isStoryExpired(story)) return { error: 'This story has expired.', status: 410 as const };

    let convo = state.conversations[0];
    if (!convo) {
      convo = {
        id: crypto.randomUUID(),
        participantIds: [user.id, story.authorId].filter((v, i, a) => a.indexOf(v) === i),
        lastMessageAt: null,
        createdAt: new Date().toISOString(),
      };
      state.conversations.push(convo);
    }

    const now = new Date().toISOString();
    const message: Message = {
      id: crypto.randomUUID(),
      conversationId: convo.id,
      senderId: user.id,
      messageType: 'story_reply',
      textContent: text,
      mediaId: null,
      sharedPostId: null,
      sharedReelId: null,
      sharedStoryId: story.id,
      replyToMessageId: null,
      reactions: [],
      readBy: [{ userId: user.id, readAt: now }],
      deletedForAll: false,
      createdAt: now,
    };
    state.messages.push(message);
    convo.lastMessageAt = now;

    return { message, recipientId: story.authorId };
  }, ['conversations', 'messages']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });

  void publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'message:new',
    data: outcome.message,
  });

  return res.status(201).json({ message: outcome.message });
});

storiesRouter.delete('/:id', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const storyId = String(req.params.id);

  const outcome = await mutateState((state) => {
    const story = state.stories.find((s) => s.id === storyId);
    if (!story) return { error: 'Story not found.', status: 404 as const };
    if (story.authorId !== user.id) return { error: 'You can only delete your own stories.', status: 403 as const };
    state.stories = state.stories.filter((s) => s.id !== storyId);
    return { ok: true };
  }, ['stories']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ ok: true });
});
