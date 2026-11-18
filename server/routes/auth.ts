import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { env, getCapabilities } from '../config/env.ts';
import { mutateState, readState } from '../db/store.ts';
import type { Connection, SessionRecord, User } from '../db/types.ts';
import { generateRandomToken, hashPassword, sha256, verifyPassword } from '../lib/crypto.ts';
import {
  type AuthenticatedRequest,
  clearAuthCookies,
  createRateLimiter,
  getActiveApprovedUsers,
  getPartnerForUser,
  requireAuth,
  sanitizeUser,
  setAuthCookies,
} from '../middleware/auth.ts';
import { recordActivity, recordAuditLog } from '../services/audit.ts';
import { getDevOutboxForRecipient, sendTransactionalEmail } from '../services/email.ts';
import { isUserOnline } from '../services/realtime.ts';

export const authRouter = express.Router();

const authLimiter = createRateLimiter({ keyPrefix: 'auth', maxRequests: 15, windowMs: 60_000 });

const registerOwnerSchema = z.object({
  email: z.string().email().max(120),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username may only contain letters, numbers, underscores, dots, and hyphens'),
  displayName: z.string().min(1).max(60),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  emailOrUsername: z.string().min(1).max(120),
  password: z.string().min(1).max(128),
});

const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(8).max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

authRouter.get('/bootstrap-status', (_req, res) => {
  const activeUsers = getActiveApprovedUsers();
  res.json({
    hasOwner: activeUsers.length > 0,
    activeAccountCount: activeUsers.length,
    maxAccounts: 2,
    slotsRemaining: Math.max(0, 2 - activeUsers.length),
    capabilities: getCapabilities(),
  });
});

authRouter.post('/register-owner', authLimiter, async (req, res) => {
  const parsed = registerOwnerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration details.' });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const username = parsed.data.username.toLowerCase().trim();
  const displayName = parsed.data.displayName.trim();
  const passwordHash = await hashPassword(parsed.data.password);
  const rawVerifyToken = generateRandomToken(32);
  const now = new Date().toISOString();
  const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const result = await mutateState((state) => {
    const active = state.users.filter((u) => u.accountStatus === 'active');
    if (active.length > 0) {
      return { error: 'Owner account is already initialized. New members must use a valid invitation.', status: 403 as const };
    }

    const userId = crypto.randomUUID();
    const user: User = {
      id: userId,
      email,
      username,
      displayName,
      passwordHash,
      bio: '',
      avatarMediaId: null,
      emailVerified: false,
      emailVerificationTokenHash: sha256(rawVerifyToken),
      emailVerificationExpiresAt: verifyExpiresAt,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      role: 'owner',
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

    const connection: Connection = {
      id: crypto.randomUUID(),
      ownerId: userId,
      partnerId: null,
      status: 'pending',
      connectedAt: null,
      disconnectedAt: null,
      disconnectedBy: null,
      relationshipTitle: 'Our Private Space',
      anniversaryDate: null,
      createdAt: now,
      updatedAt: now,
    };

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

    state.users.push(user);
    state.connections.push(connection);
    state.sessions.push(session);
    return { user, sessionId };
  }, ['users', 'connections', 'sessions']);

  if ('error' in result) {
    return res.status(result.status as number).json({ error: result.error });
  }

  const origin = `${req.protocol}://${req.get('host')}`;
  const verifyUrl = `${origin}/verify-email?token=${encodeURIComponent(rawVerifyToken)}`;

  const emailResult = await sendTransactionalEmail({
    to: result.user.email,
    subject: 'Verify your TogetherSpace owner email',
    html: `<p>Welcome to TogetherSpace, ${result.user.displayName}.</p><p>Verify your email by clicking: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
    text: `Welcome to TogetherSpace. Verify your email: ${verifyUrl}`,
    actionUrl: verifyUrl,
  });

  setAuthCookies(res, result.user, result.sessionId);
  await recordAuditLog({
    userId: result.user.id,
    action: 'auth.register_owner',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  await recordActivity({
    userId: result.user.id,
    summary: 'Initialized TogetherSpace private owner account',
    category: 'connection',
  });

  return res.status(201).json({
    user: sanitizeUser(result.user, true),
    emailVerificationSent: emailResult.delivered,
    devPreviewUrl: emailResult.previewUrl,
  });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please provide your email/username and password.' });
  }

  const identifier = parsed.data.emailOrUsername.toLowerCase().trim();
  const state = readState();
  const user = state.users.find(
    (u) =>
      u.accountStatus === 'active' &&
      (u.email.toLowerCase() === identifier || u.username.toLowerCase() === identifier)
  );

  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await recordAuditLog({
      userId: user?.id || null,
      action: 'auth.login_failed',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.status(401).json({ error: 'Invalid credentials. Please check your email and password.' });
  }

  const now = new Date().toISOString();
  const sessionId = crypto.randomUUID();
  const session: SessionRecord = {
    id: sessionId,
    userId: user.id,
    userAgent: (req.headers['user-agent'] || 'Unknown device').slice(0, 200),
    ipAddress: req.ip || 'unknown',
    revoked: false,
    lastActiveAt: now,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
  };

  await mutateState((s) => {
    s.sessions.push(session);
  }, ['sessions']);

  setAuthCookies(res, user, sessionId);
  await recordAuditLog({
    userId: user.id,
    action: 'auth.login_success',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    metadata: { sessionId },
  });

  return res.json({ user: sanitizeUser(user, true) });
});

authRouter.post('/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  const sessionId = req.authSessionId;
  const userId = req.authUser!.id;
  await mutateState((s) => {
    const sess = s.sessions.find((item) => item.id === sessionId);
    if (sess) sess.revoked = true;
  }, ['sessions']);
  clearAuthCookies(res);
  await recordAuditLog({
    userId,
    action: 'auth.logout',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  return res.json({ ok: true });
});

authRouter.post('/verify-email', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token) {
    return res.status(400).json({ error: 'Verification token is required.' });
  }
  const tokenHash = sha256(token);

  const outcome = await mutateState((state) => {
    const user = state.users.find(
      (u) => u.accountStatus === 'active' && u.emailVerificationTokenHash === tokenHash
    );
    if (!user) return { error: 'Verification link is invalid or already used.', status: 400 as const };
    if (
      user.emailVerificationExpiresAt &&
      new Date(user.emailVerificationExpiresAt).getTime() < Date.now()
    ) {
      return { error: 'Verification link has expired. Please request a new one.', status: 400 as const };
    }
    user.emailVerified = true;
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    user.updatedAt = new Date().toISOString();
    return { user };
  }, ['users']);

  if ('error' in outcome) {
    return res.status(outcome.status as number).json({ error: outcome.error });
  }

  await recordAuditLog({
    userId: outcome.user.id,
    action: 'auth.email_verified',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({ ok: true, user: sanitizeUser(outcome.user, true) });
});

authRouter.post('/resend-verification', requireAuth, authLimiter, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (user.emailVerified) {
    return res.json({ ok: true, alreadyVerified: true });
  }

  const rawToken = generateRandomToken(32);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await mutateState((state) => {
    const target = state.users.find((u) => u.id === user.id);
    if (target) {
      target.emailVerificationTokenHash = sha256(rawToken);
      target.emailVerificationExpiresAt = expiresAt;
      target.updatedAt = new Date().toISOString();
    }
  }, ['users']);

  const origin = `${req.protocol}://${req.get('host')}`;
  const verifyUrl = `${origin}/verify-email?token=${encodeURIComponent(rawToken)}`;

  const emailRes = await sendTransactionalEmail({
    to: user.email,
    subject: 'Verify your TogetherSpace email',
    html: `<p>Verify your email by clicking: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
    text: `Verify your TogetherSpace email: ${verifyUrl}`,
    actionUrl: verifyUrl,
  });

  return res.json({ ok: true, devPreviewUrl: emailRes.previewUrl });
});

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
  if (!email) {
    return res.status(400).json({ error: 'Please enter your account email address.' });
  }

  const rawResetToken = generateRandomToken(32);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const foundUser = await mutateState((state) => {
    const user = state.users.find((u) => u.accountStatus === 'active' && u.email === email);
    if (!user) return null;
    user.passwordResetTokenHash = sha256(rawResetToken);
    user.passwordResetExpiresAt = expiresAt;
    user.updatedAt = new Date().toISOString();
    return user;
  }, ['users']);

  let previewUrl: string | undefined;
  if (foundUser) {
    const origin = `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(rawResetToken)}`;
    const sent = await sendTransactionalEmail({
      to: foundUser.email,
      subject: 'Reset your TogetherSpace password',
      html: `<p>Reset your password (valid for 30 minutes): <a href="${resetUrl}">${resetUrl}</a></p>`,
      text: `Reset your TogetherSpace password: ${resetUrl}`,
      actionUrl: resetUrl,
    });
    previewUrl = sent.previewUrl;
    await recordAuditLog({
      userId: foundUser.id,
      action: 'auth.password_reset_requested',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  return res.json({
    ok: true,
    message: 'If an account matches that email, password reset instructions have been sent.',
    devPreviewUrl: env.isProd ? undefined : previewUrl,
  });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid password reset input.' });
  }

  const tokenHash = sha256(parsed.data.token);
  const newHash = await hashPassword(parsed.data.newPassword);

  const outcome = await mutateState((state) => {
    const user = state.users.find(
      (u) => u.accountStatus === 'active' && u.passwordResetTokenHash === tokenHash
    );
    if (!user) {
      return { error: 'Password reset link is invalid or has already been used.', status: 400 as const };
    }
    if (user.passwordResetExpiresAt && new Date(user.passwordResetExpiresAt).getTime() < Date.now()) {
      return { error: 'Password reset link has expired. Please request a new one.', status: 400 as const };
    }

    user.passwordHash = newHash;
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    user.updatedAt = new Date().toISOString();

    // Revoke all active sessions after password reset
    for (const s of state.sessions) {
      if (s.userId === user.id) s.revoked = true;
    }

    return { user };
  }, ['users', 'sessions']);

  if ('error' in outcome) {
    return res.status(outcome.status as number).json({ error: outcome.error });
  }

  clearAuthCookies(res);
  await recordAuditLog({
    userId: outcome.user.id,
    action: 'auth.password_reset_completed',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({ ok: true, message: 'Password updated. All existing sessions have been signed out.' });
});

authRouter.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid password input.' });
  }

  const user = req.authUser!;
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await mutateState((state) => {
    const target = state.users.find((u) => u.id === user.id);
    if (target) {
      target.passwordHash = newHash;
      target.updatedAt = new Date().toISOString();
    }
    for (const s of state.sessions) {
      if (s.userId === user.id && s.id !== req.authSessionId) {
        s.revoked = true;
      }
    }
  }, ['users', 'sessions']);

  await recordAuditLog({
    userId: user.id,
    action: 'auth.password_changed',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({ ok: true, message: 'Password updated and other sessions revoked.' });
});

authRouter.get('/session', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const state = readState();
  const partner = getPartnerForUser(user.id);
  const connection = state.connections[0] || null;
  const googleAccount = state.googleAccounts.find((g) => g.userId === user.id);
  const unreadNotifications = state.notifications.filter((n) => n.recipientId === user.id && !n.read).length;

  return res.json({
    user: sanitizeUser(user, true),
    partner: partner
      ? {
          ...sanitizeUser(partner, false),
          online: partner.privacyPrefs.onlinePresence ? isUserOnline(partner.id) : false,
        }
      : null,
    connection,
    googleDrive: googleAccount
      ? {
          connected: googleAccount.connectionStatus === 'connected',
          status: googleAccount.connectionStatus,
          googleEmail: googleAccount.googleEmail,
          lastQuotaBytesTotal: googleAccount.lastQuotaBytesTotal,
          lastQuotaBytesUsed: googleAccount.lastQuotaBytesUsed,
          updatedAt: googleAccount.updatedAt,
        }
      : { connected: false, status: 'disconnected' },
    unreadNotifications,
    capabilities: getCapabilities(),
    devEmails: env.isProd ? [] : getDevOutboxForRecipient(user.email),
  });
});
