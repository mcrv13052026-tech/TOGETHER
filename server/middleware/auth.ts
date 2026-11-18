import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.ts';
import { mutateState, readState } from '../db/store.ts';
import type { User } from '../db/types.ts';
import { generateRandomToken, safeEqual, signSessionJwt, verifySessionJwt } from '../lib/crypto.ts';

export const SESSION_COOKIE_NAME = 'ts_session';
export const CSRF_COOKIE_NAME = 'ts_csrf';

export interface AuthenticatedRequest extends Request {
  authUser?: User;
  authSessionId?: string;
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://*.googleusercontent.com",
      "media-src 'self' blob: data:",
      "connect-src 'self' https://rest.ably.io wss://realtime.ably.io https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com",
      "frame-ancestors 'self' https://aistudio.google.com https://*.google.com",
    ].join('; ')
  );
  next();
}

export function setAuthCookies(res: Response, user: User, sessionId: string) {
  const token = signSessionJwt({ sub: user.id, sid: sessionId, role: user.role });
  const csrfToken = generateRandomToken(24);
  const secureFlag = env.isProd && env.appUrl.startsWith('https://');

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureFlag,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: false,
    secure: secureFlag,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies?.[CSRF_COOKIE_NAME]) {
    const secureFlag = env.isProd && env.appUrl.startsWith('https://');
    res.cookie(CSRF_COOKIE_NAME, generateRandomToken(24), {
      httpOnly: false,
      secure: secureFlag,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
  next();
}

export function verifyCsrf(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  // Allow public auth bootstrap routes without prior CSRF header if cookie isn't set yet,
  // while still enforcing double-submit whenever ts_csrf cookie is present.
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken) {
    return next();
  }
  if (typeof headerToken !== 'string' || !safeEqual(cookieToken, headerToken)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF verification token.' });
  }
  return next();
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const payload = verifySessionJwt(token);
  if (!payload) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  const state = readState();
  const session = state.sessions.find((s) => s.id === payload.sid && s.userId === payload.sub);
  if (!session || session.revoked || new Date(session.expiresAt).getTime() <= Date.now()) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Session is no longer active. Please sign in again.' });
  }

  const user = state.users.find((u) => u.id === payload.sub && u.accountStatus === 'active');
  if (!user) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Account not found or deactivated.' });
  }

  req.authUser = user;
  req.authSessionId = session.id;

  // Touch session activity asynchronously (every >60s to avoid excess writes)
  if (Date.now() - new Date(session.lastActiveAt).getTime() > 60_000) {
    void mutateState((s) => {
      const target = s.sessions.find((item) => item.id === session.id);
      if (target) target.lastActiveAt = new Date().toISOString();
    }, ['sessions']);
  }

  return next();
}

export function requireVerifiedEmail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (!req.authUser.emailVerified) {
    return res.status(403).json({
      error: 'Please verify your email address before accessing TogetherSpace content.',
      code: 'EMAIL_NOT_VERIFIED',
    });
  }
  return next();
}

export function getActiveApprovedUsers(users = readState().users): User[] {
  return users.filter((u) => u.accountStatus === 'active');
}

export function getPartnerForUser(userId: string): User | null {
  const active = getActiveApprovedUsers();
  return active.find((u) => u.id !== userId) || null;
}

export function sanitizeUser(user: User, isSelf = false) {
  return {
    id: user.id,
    email: isSelf ? user.email : undefined,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatarMediaId: user.avatarMediaId,
    emailVerified: user.emailVerified,
    role: user.role,
    themePreference: isSelf ? user.themePreference : undefined,
    notificationPrefs: isSelf ? user.notificationPrefs : undefined,
    privacyPrefs: user.privacyPrefs,
    createdAt: user.createdAt,
  };
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function createRateLimiter(opts: { keyPrefix: string; maxRequests: number; windowMs: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${opts.keyPrefix}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    if (bucket.count >= opts.maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Too many requests. Please wait ${retryAfter} seconds and try again.`,
      });
    }
    bucket.count += 1;
    return next();
  };
}
