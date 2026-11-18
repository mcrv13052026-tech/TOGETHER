import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { mutateState, readState } from '../db/store.ts';
import type { Conversation, Invitation, NotificationItem, SessionRecord, User } from '../db/types.ts';
import { generateRandomToken, hashPassword, sha256 } from '../lib/crypto.ts';
import {
  type AuthenticatedRequest,
  createRateLimiter,
  requireAuth,
  requireVerifiedEmail,
  sanitizeUser,
  setAuthCookies,
} from '../middleware/auth.ts';
import { recordActivity, recordAuditLog } from '../services/audit.ts';
import { sendTransactionalEmail } from '../services/email.ts';
import { publishRealtimeEvent } from '../services/realtime.ts';

export const invitationsRouter = express.Router();
export const connectionRouter = express.Router();

const inviteLimiter = createRateLimiter({ keyPrefix: 'invite', maxRequests: 15, windowMs: 60_000 });

const createInviteSchema = z.object({
  intendedEmail: z.string().email().max(120).optional().or(z.literal('')),
  expiresInHours: z.number().int().min(1).max(24 * 30).optional().default(168),
});

const acceptInviteSchema = z.object({
  token: z.string().min(10).max(200),
  email: z.string().email().max(120),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username may only contain letters, numbers, underscores, dots, and hyphens'),
  displayName: z.string().min(1).max(60),
  password: z.string().min(8).max(128),
});

function refreshExpiredInvitations(invitations: Invitation[]) {
  const now = Date.now();
  for (const inv of invitations) {
    if (inv.status === 'pending' && new Date(inv.expiresAt).getTime() <= now) {
      inv.status = 'expired';
    }
  }
}

invitationsRouter.post('/create', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (user.role !== 'owner') {
    return res.status(403).json({ error: 'Only the TogetherSpace owner can create invitations.' });
  }

  const parsed = createInviteSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid invitation parameters.' });
  }

  const rawToken = generateRandomToken(32);
  const intendedEmail = parsed.data.intendedEmail ? parsed.data.intendedEmail.toLowerCase().trim() : null;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000).toISOString();

  const outcome = await mutateState((state) => {
    refreshExpiredInvitations(state.invitations);
    const activeUsers = state.users.filter((u) => u.accountStatus === 'active');
    if (activeUsers.length >= 2) {
      return { error: 'TogetherSpace already has two approved accounts.', status: 409 as const };
    }

    // Revoke any existing pending invitations so only one replacement link is active
    for (const inv of state.invitations) {
      if (inv.status === 'pending') {
        inv.status = 'revoked';
        inv.revokedAt = now;
      }
    }

    const invitation: Invitation = {
      id: crypto.randomUUID(),
      tokenHash: sha256(rawToken),
      inviterId: user.id,
      intendedEmail,
      status: 'pending',
      expiresAt,
      acceptedUserId: null,
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
    };

    state.invitations.unshift(invitation);
    return { invitation };
  }, ['invitations']);

  if ('error' in outcome) {
    return res.status(outcome.status as number).json({ error: outcome.error });
  }

  const origin = `${req.protocol}://${req.get('host')}`;
  const inviteUrl = `${origin}/invite/${encodeURIComponent(rawToken)}`;

  let emailDelivered = false;
  if (intendedEmail) {
    const emailRes = await sendTransactionalEmail({
      to: intendedEmail,
      subject: `${user.displayName} invited you to TogetherSpace`,
      html: `<p>${user.displayName} invited you to join their private TogetherSpace.</p><p>Accept invitation: <a href="${inviteUrl}">${inviteUrl}</a></p>`,
      text: `${user.displayName} invited you to TogetherSpace: ${inviteUrl}`,
      actionUrl: inviteUrl,
    });
    emailDelivered = emailRes.delivered;
  }

  await recordAuditLog({
    userId: user.id,
    action: 'invitation.created',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    metadata: { invitationId: outcome.invitation.id, hasEmailBinding: Boolean(intendedEmail) },
  });

  return res.status(201).json({
    invitation: {
      id: outcome.invitation.id,
      intendedEmail: outcome.invitation.intendedEmail,
      status: outcome.invitation.status,
      expiresAt: outcome.invitation.expiresAt,
      createdAt: outcome.invitation.createdAt,
    },
    inviteUrl,
    emailDelivered,
  });
});

invitationsRouter.get('/status', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (user.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can review invitation details.' });
  }

  await mutateState((state) => {
    refreshExpiredInvitations(state.invitations);
  }, ['invitations']);

  const state = readState();
  const activeUsers = state.users.filter((u) => u.accountStatus === 'active');
  const partner = activeUsers.find((u) => u.id !== user.id) || null;
  const invitations = state.invitations.map((inv) => ({
    id: inv.id,
    intendedEmail: inv.intendedEmail,
    status: inv.status,
    expiresAt: inv.expiresAt,
    acceptedAt: inv.acceptedAt,
    revokedAt: inv.revokedAt,
    createdAt: inv.createdAt,
  }));

  return res.json({
    accountCount: activeUsers.length,
    maxAccounts: 2,
    partnerJoined: Boolean(partner),
    partnerEmailVerified: partner?.emailVerified ?? false,
    invitations,
  });
});

invitationsRouter.get('/validate', inviteLimiter, async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) {
    return res.status(400).json({ valid: false, reason: 'missing_token', error: 'Invitation token is missing.' });
  }

  const tokenHash = sha256(token);
  const result = await mutateState((state) => {
    refreshExpiredInvitations(state.invitations);
    const activeUsers = state.users.filter((u) => u.accountStatus === 'active');
    if (activeUsers.length >= 2) {
      return { valid: false, reason: 'account_limit_reached', error: 'This TogetherSpace already has two approved members.' };
    }

    const inv = state.invitations.find((i) => i.tokenHash === tokenHash);
    if (!inv) {
      return { valid: false, reason: 'invalid', error: 'This invitation link is not valid.' };
    }
    if (inv.status === 'accepted') {
      return { valid: false, reason: 'already_used', error: 'This invitation has already been used.' };
    }
    if (inv.status === 'revoked') {
      return { valid: false, reason: 'revoked', error: 'This invitation has been revoked by the owner.' };
    }
    if (inv.status === 'expired' || new Date(inv.expiresAt).getTime() <= Date.now()) {
      inv.status = 'expired';
      return { valid: false, reason: 'expired', error: 'This invitation has expired. Ask the owner for a replacement link.' };
    }

    const inviter = state.users.find((u) => u.id === inv.inviterId);
    return {
      valid: true,
      intendedEmail: inv.intendedEmail,
      expiresAt: inv.expiresAt,
      inviterName: inviter?.displayName || 'Your partner',
      inviterUsername: inviter?.username || 'owner',
    };
  }, ['invitations']);

  if (!result.valid) {
    return res.status(400).json(result);
  }
  return res.json(result);
});

invitationsRouter.post('/accept', inviteLimiter, async (req, res) => {
  const parsed = acceptInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration details.' });
  }

  const tokenHash = sha256(parsed.data.token);
  const email = parsed.data.email.toLowerCase().trim();
  const username = parsed.data.username.toLowerCase().trim();
  const displayName = parsed.data.displayName.trim();
  const passwordHash = await hashPassword(parsed.data.password);
  const rawVerifyToken = generateRandomToken(32);
  const now = new Date().toISOString();

  // Atomic lock prevents race conditions on simultaneous final-slot acceptance
  const outcome = await mutateState((state) => {
    refreshExpiredInvitations(state.invitations);
    const activeUsers = state.users.filter((u) => u.accountStatus === 'active');
    if (activeUsers.length >= 2) {
      return { error: 'Account limit reached. Only two approved accounts are allowed.', status: 403 as const };
    }

    const inv = state.invitations.find((i) => i.tokenHash === tokenHash);
    if (!inv) return { error: 'Invalid invitation token.', status: 400 as const };
    if (inv.status === 'accepted') return { error: 'This invitation has already been used.', status: 409 as const };
    if (inv.status === 'revoked') return { error: 'This invitation was revoked by the owner.', status: 403 as const };
    if (inv.status === 'expired' || new Date(inv.expiresAt).getTime() <= Date.now()) {
      inv.status = 'expired';
      return { error: 'This invitation has expired.', status: 400 as const };
    }
    if (inv.intendedEmail && inv.intendedEmail.toLowerCase() !== email) {
      return {
        error: 'This invitation is bound to a different email address.',
        status: 403 as const,
      };
    }

    if (state.users.some((u) => u.accountStatus === 'active' && (u.email === email || u.username === username))) {
      return { error: 'Email or username is already taken.', status: 409 as const };
    }

    const userId = crypto.randomUUID();
    const partnerUser: User = {
      id: userId,
      email,
      username,
      displayName,
      passwordHash,
      bio: '',
      avatarMediaId: null,
      emailVerified: false,
      emailVerificationTokenHash: sha256(rawVerifyToken),
      emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      role: 'partner',
      accountStatus: 'active',
      themePreference: 'system',
      notificationPrefs: {
        messages: true,
        likesAndComments: true,
        stories: true,
        calls: true,
        invitations: true,
      },
      privacyPrefs: {
        readReceipts: true,
        onlinePresence: true,
        activityStatus: true,
      },
      createdAt: now,
      updatedAt: now,
    };

    // Atomically consume invitation
    inv.status = 'accepted';
    inv.acceptedUserId = userId;
    inv.acceptedAt = now;

    // Update or create connection
    let conn = state.connections[0];
    if (!conn) {
      conn = {
        id: crypto.randomUUID(),
        ownerId: inv.inviterId,
        partnerId: userId,
        status: 'connected',
        connectedAt: now,
        disconnectedAt: null,
        disconnectedBy: null,
        relationshipTitle: 'Our Private Space',
        anniversaryDate: null,
        createdAt: now,
        updatedAt: now,
      };
      state.connections.push(conn);
    } else {
      conn.partnerId = userId;
      conn.status = 'connected';
      conn.connectedAt = now;
      conn.disconnectedAt = null;
      conn.disconnectedBy = null;
      conn.updatedAt = now;
    }

    // Create private 1:1 conversation if none exists
    if (state.conversations.length === 0) {
      const convo: Conversation = {
        id: crypto.randomUUID(),
        participantIds: [inv.inviterId, userId],
        lastMessageAt: null,
        createdAt: now,
      };
      state.conversations.push(convo);
    } else {
      state.conversations[0].participantIds = [inv.inviterId, userId];
    }

    // Grant partner read access to existing shared media
    for (const m of state.media) {
      if (!m.allowedViewerIds.includes(userId)) {
        m.allowedViewerIds.push(userId);
      }
    }

    const notification: NotificationItem = {
      id: crypto.randomUUID(),
      recipientId: inv.inviterId,
      actorId: userId,
      type: 'invite_accepted',
      title: 'Invitation accepted',
      body: `${displayName} (@${username}) joined your TogetherSpace.`,
      link: '/settings',
      read: false,
      createdAt: now,
    };
    state.notifications.unshift(notification);

    const sessionId = crypto.randomUUID();
    const session: SessionRecord = {
      id: sessionId,
      userId,
      userAgent: (req.headers['user-agent'] || 'Unknown device').slice(0, 200),
      ipAddress: req.ip || 'unknown',
      revoked: false,
      lastActiveAt: now,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
    };

    state.users.push(partnerUser);
    state.sessions.push(session);

    return { user: partnerUser, sessionId, inviterId: inv.inviterId, notification };
  }, ['users', 'invitations', 'connections', 'conversations', 'media', 'notifications', 'sessions']);

  if ('error' in outcome) {
    return res.status(outcome.status as number).json({ error: outcome.error });
  }

  const origin = `${req.protocol}://${req.get('host')}`;
  const verifyUrl = `${origin}/verify-email?token=${encodeURIComponent(rawVerifyToken)}`;

  const emailRes = await sendTransactionalEmail({
    to: outcome.user.email,
    subject: 'Verify your TogetherSpace email',
    html: `<p>Welcome to TogetherSpace, ${outcome.user.displayName}.</p><p>Verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
    text: `Verify your TogetherSpace email: ${verifyUrl}`,
    actionUrl: verifyUrl,
  });

  setAuthCookies(res, outcome.user, outcome.sessionId);
  await publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'notification:new',
    data: outcome.notification,
    targetUserIds: [outcome.inviterId],
  });
  await recordAuditLog({
    userId: outcome.user.id,
    action: 'invitation.accepted',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  await recordActivity({
    userId: outcome.user.id,
    summary: `${outcome.user.displayName} joined the private connection`,
    category: 'connection',
  });

  return res.status(201).json({
    user: sanitizeUser(outcome.user, true),
    devPreviewUrl: env.isProd ? undefined : emailRes.previewUrl,
  });
});

invitationsRouter.post('/revoke', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (user.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can revoke invitations.' });
  }

  const invitationId = typeof req.body?.invitationId === 'string' ? req.body.invitationId : null;
  const now = new Date().toISOString();

  await mutateState((state) => {
    for (const inv of state.invitations) {
      if (inv.status === 'pending' && (!invitationId || inv.id === invitationId)) {
        inv.status = 'revoked';
        inv.revokedAt = now;
      }
    }
  }, ['invitations']);

  await recordAuditLog({
    userId: user.id,
    action: 'invitation.revoked',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({ ok: true });
});

connectionRouter.get('/status', requireAuth, (req: AuthenticatedRequest, res) => {
  const state = readState();
  const conn = state.connections[0] || null;
  const activeUsers = state.users.filter((u) => u.accountStatus === 'active');
  const partner = activeUsers.find((u) => u.id !== req.authUser!.id) || null;
  const sharedAlbumsCount = state.albums.filter((a) => a.isShared).length;
  const sharedPostsCount = state.posts.length;

  return res.json({
    connection: conn,
    partner: partner ? sanitizeUser(partner, false) : null,
    sharedAlbumsCount,
    sharedPostsCount,
  });
});

connectionRouter.patch('/details', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    relationshipTitle: z.string().min(1).max(60).optional(),
    anniversaryDate: z.string().max(30).nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid connection details.' });
  }

  const updated = await mutateState((state) => {
    const conn = state.connections[0];
    if (!conn) return null;
    if (parsed.data.relationshipTitle !== undefined) conn.relationshipTitle = parsed.data.relationshipTitle.trim();
    if (parsed.data.anniversaryDate !== undefined) conn.anniversaryDate = parsed.data.anniversaryDate;
    conn.updatedAt = new Date().toISOString();
    return conn;
  }, ['connections']);

  return res.json({ connection: updated });
});

connectionRouter.post('/disconnect', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const now = new Date().toISOString();

  await mutateState((state) => {
    const conn = state.connections[0];
    if (conn) {
      conn.status = 'disconnected';
      conn.disconnectedAt = now;
      conn.disconnectedBy = user.id;
      conn.updatedAt = now;
    }

    // If partner disconnects or owner disconnects partner, revoke partner's access to owner media & mark partner deleted if owner removes partner
    if (user.role === 'owner' && conn?.partnerId) {
      const partner = state.users.find((u) => u.id === conn.partnerId);
      if (partner) {
        partner.accountStatus = 'deleted';
        partner.updatedAt = now;
      }
      for (const s of state.sessions) {
        if (s.userId === conn.partnerId) s.revoked = true;
      }
      conn.partnerId = null;
    } else if (user.role === 'partner') {
      // Partner voluntarily disconnects: revoke their own session access cleanly without touching owner's Drive files
      user.accountStatus = 'deleted';
      user.updatedAt = now;
      const targetUser = state.users.find((u) => u.id === user.id);
      if (targetUser) {
        targetUser.accountStatus = 'deleted';
        targetUser.updatedAt = now;
      }
      for (const s of state.sessions) {
        if (s.userId === user.id) s.revoked = true;
      }
      if (conn) conn.partnerId = null;
    }
  }, ['connections', 'users', 'sessions']);

  await recordAuditLog({
    userId: user.id,
    action: 'connection.disconnected',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({
    ok: true,
    message: 'Private connection disconnected. Existing Google Drive files in each personal account remain untouched.',
  });
});
