import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { mutateState, readState } from '../db/store.ts';
import {
  type AuthenticatedRequest,
  clearAuthCookies,
  getPartnerForUser,
  requireAuth,
  requireVerifiedEmail,
  sanitizeUser,
} from '../middleware/auth.ts';
import { recordAuditLog } from '../services/audit.ts';
import { registerSseClient, unregisterSseClient } from '../services/realtime.ts';

export const profileRouter = express.Router();
export const privacyRouter = express.Router();
export const notificationsRouter = express.Router();
export const realtimeRouter = express.Router();

profileRouter.get('/overview', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const partner = getPartnerForUser(user.id);
  const state = readState();

  const targetUserId = partner && req.query.userId === partner.id ? partner.id : user.id;
  const targetUser = state.users.find((u) => u.id === targetUserId && u.accountStatus === 'active');
  if (!targetUser) return res.status(404).json({ error: 'Profile not found.' });

  const posts = state.posts
    .filter((p) => p.authorId === targetUser.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => ({
      ...p,
      media: p.mediaIds.map((id) => ({ id, url: `/api/media/stream/${id}` })),
      likesCount: state.likes.filter((l) => l.targetType === 'post' && l.targetId === p.id).length,
      commentsCount: state.comments.filter((c) => c.targetType === 'post' && c.targetId === p.id).length,
    }));

  const reels = state.reels
    .filter((r) => r.authorId === targetUser.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => ({
      ...r,
      videoUrl: `/api/media/stream/${r.mediaId}`,
    }));

  const albums = state.albums.filter((a) => a.creatorId === targetUser.id || (targetUser.id !== user.id && a.isShared));

  const saved =
    targetUser.id === user.id
      ? state.savedMedia
          .filter((s) => s.userId === user.id)
          .map((s) => {
            if (s.targetType === 'post') {
              const p = state.posts.find((item) => item.id === s.targetId);
              return p
                ? {
                    type: 'post' as const,
                    id: p.id,
                    caption: p.caption,
                    mediaUrl: p.mediaIds[0] ? `/api/media/stream/${p.mediaIds[0]}` : null,
                    createdAt: s.createdAt,
                  }
                : null;
            }
            const r = state.reels.find((item) => item.id === s.targetId);
            return r
              ? {
                  type: 'reel' as const,
                  id: r.id,
                  caption: r.caption,
                  mediaUrl: `/api/media/stream/${r.mediaId}`,
                  createdAt: s.createdAt,
                }
              : null;
          })
          .filter(Boolean)
      : [];

  return res.json({
    profile: sanitizeUser(targetUser, targetUser.id === user.id),
    posts,
    reels,
    albumsCount: albums.length,
    saved,
  });
});

profileRouter.patch('/update', requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    displayName: z.string().min(1).max(60).optional(),
    username: z
      .string()
      .min(3)
      .max(30)
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .optional(),
    bio: z.string().max(300).optional(),
    avatarMediaId: z.string().nullable().optional(),
    themePreference: z.enum(['system', 'light', 'dark']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile fields.' });
  }

  const user = req.authUser!;

  const outcome = await mutateState((state) => {
    const target = state.users.find((u) => u.id === user.id);
    if (!target) return { error: 'User not found.', status: 404 as const };

    if (parsed.data.username) {
      const normalized = parsed.data.username.toLowerCase().trim();
      const taken = state.users.some(
        (u) => u.id !== user.id && u.accountStatus === 'active' && u.username === normalized
      );
      if (taken) return { error: 'Username is already taken.', status: 409 as const };
      target.username = normalized;
    }

    if (parsed.data.displayName !== undefined) target.displayName = parsed.data.displayName.trim();
    if (parsed.data.bio !== undefined) target.bio = parsed.data.bio.trim();
    if (parsed.data.avatarMediaId !== undefined) target.avatarMediaId = parsed.data.avatarMediaId;
    if (parsed.data.themePreference !== undefined) target.themePreference = parsed.data.themePreference;
    target.updatedAt = new Date().toISOString();
    return { user: target };
  }, ['users']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });
  return res.json({ user: sanitizeUser(outcome.user, true) });
});

privacyRouter.get('/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const sessions = readState()
    .sessions.filter((s) => s.userId === user.id && !s.revoked && new Date(s.expiresAt).getTime() > Date.now())
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    .map((s) => ({
      ...s,
      isCurrent: s.id === req.authSessionId,
    }));

  return res.json({ sessions });
});

privacyRouter.post('/revoke-sessions', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const targetSessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null;

  await mutateState((state) => {
    for (const s of state.sessions) {
      if (s.userId !== user.id) continue;
      if (targetSessionId) {
        if (s.id === targetSessionId) s.revoked = true;
      } else if (s.id !== req.authSessionId) {
        s.revoked = true;
      }
    }
  }, ['sessions']);

  await recordAuditLog({
    userId: user.id,
    action: targetSessionId ? 'privacy.session_revoked' : 'privacy.all_other_sessions_revoked',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({ ok: true });
});

privacyRouter.patch('/preferences', requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    notificationPrefs: z
      .object({
        messages: z.boolean(),
        likesAndComments: z.boolean(),
        stories: z.boolean(),
        calls: z.boolean(),
        invitations: z.boolean(),
      })
      .partial()
      .optional(),
    privacyPrefs: z
      .object({
        readReceipts: z.boolean(),
        onlinePresence: z.boolean(),
        activityStatus: z.boolean(),
      })
      .partial()
      .optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid preferences.' });

  const user = req.authUser!;
  const updated = await mutateState((state) => {
    const target = state.users.find((u) => u.id === user.id);
    if (!target) return null;
    if (parsed.data.notificationPrefs) {
      target.notificationPrefs = { ...target.notificationPrefs, ...parsed.data.notificationPrefs };
    }
    if (parsed.data.privacyPrefs) {
      target.privacyPrefs = { ...target.privacyPrefs, ...parsed.data.privacyPrefs };
    }
    target.updatedAt = new Date().toISOString();
    return target;
  }, ['users']);

  return res.json({ user: updated ? sanitizeUser(updated, true) : null });
});

privacyRouter.get('/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const logs = readState()
    .auditLogs.filter((l) => l.userId === user.id)
    .slice(0, 50);
  return res.json({ logs });
});

privacyRouter.get('/export', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const state = readState();

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    account: sanitizeUser(user, true),
    googleAccount: state.googleAccounts
      .filter((g) => g.userId === user.id)
      .map((g) => ({
        googleEmail: g.googleEmail,
        connectionStatus: g.connectionStatus,
        grantedScopes: g.grantedScopes,
        createdAt: g.createdAt,
      })),
    posts: state.posts.filter((p) => p.authorId === user.id),
    reels: state.reels.filter((r) => r.authorId === user.id),
    stories: state.stories.filter((s) => s.authorId === user.id),
    albums: state.albums.filter((a) => a.creatorId === user.id),
    messagesSent: state.messages.filter((m) => m.senderId === user.id),
    mediaMetadata: state.media.filter((m) => m.ownerId === user.id),
    calls: state.calls.filter((c) => c.callerId === user.id || c.calleeId === user.id),
  };

  await recordAuditLog({
    userId: user.id,
    action: 'privacy.data_exported',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.setHeader('Content-Disposition', `attachment; filename="togetherspace-export-${user.username}.json"`);
  return res.json(exportPayload);
});

privacyRouter.post('/delete-account', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const confirmText = typeof req.body?.confirm === 'string' ? req.body.confirm : '';
  if (confirmText !== 'DELETE') {
    return res.status(400).json({ error: 'Type DELETE to confirm permanent account deletion.' });
  }

  await mutateState((state) => {
    const target = state.users.find((u) => u.id === user.id);
    if (target) {
      target.accountStatus = 'deleted';
      target.updatedAt = new Date().toISOString();
    }
    // Disconnect stored Google tokens for this user ONLY — do NOT delete other user's files or remote Drive files
    state.googleAccounts = state.googleAccounts.filter((g) => g.userId !== user.id);
    for (const s of state.sessions) {
      if (s.userId === user.id) s.revoked = true;
    }
    const conn = state.connections[0];
    if (conn) {
      if (conn.partnerId === user.id) {
        conn.partnerId = null;
        conn.status = 'disconnected';
        conn.disconnectedAt = new Date().toISOString();
        conn.disconnectedBy = user.id;
      } else if (conn.ownerId === user.id) {
        conn.status = 'disconnected';
        conn.disconnectedAt = new Date().toISOString();
        conn.disconnectedBy = user.id;
      }
    }
  }, ['users', 'googleAccounts', 'sessions', 'connections']);

  await recordAuditLog({
    userId: user.id,
    action: 'privacy.account_deleted',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  clearAuthCookies(res);
  return res.json({
    ok: true,
    message: 'Your TogetherSpace account has been deleted. Personal Google Drive files were not erased.',
  });
});

notificationsRouter.get('/list', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const state = readState();
  const notifications = state.notifications
    .filter((n) => n.recipientId === user.id)
    .slice(0, 40);
  const activities = state.activities.slice(0, 15);
  return res.json({ notifications, activities });
});

notificationsRouter.post('/read-all', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  await mutateState((state) => {
    for (const n of state.notifications) {
      if (n.recipientId === user.id) n.read = true;
    }
  }, ['notifications']);
  return res.json({ ok: true });
});

realtimeRouter.get('/stream', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const clientId = crypto.randomUUID();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, userId: user.id })}\n\n`);

  registerSseClient(clientId, user.id, res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      unregisterSseClient(clientId);
    }
  }, 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unregisterSseClient(clientId);
  });
});

realtimeRouter.get('/ably-auth', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  if (!env.ablyApiKey) {
    return res.json({ configured: false, mode: 'sse' });
  }
  try {
    const [keyName, keySecret] = env.ablyApiKey.split(':');
    const authHeader = 'Basic ' + Buffer.from(env.ablyApiKey).toString('base64');
    const tokenRes = await fetch(`https://rest.ably.io/keys/${encodeURIComponent(keyName)}/requestToken`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keyName,
        clientId: req.authUser!.id,
        timestamp: Date.now(),
        capability: JSON.stringify({ 'togetherspace-private': ['subscribe', 'publish', 'presence'] }),
        mac: keySecret ? undefined : undefined,
      }),
    });
    if (!tokenRes.ok) {
      return res.json({ configured: false, mode: 'sse' });
    }
    const tokenRequest = await tokenRes.json();
    return res.json({ configured: true, mode: 'ably', tokenRequest });
  } catch {
    return res.json({ configured: false, mode: 'sse' });
  }
});
