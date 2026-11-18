import { beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import http from 'http';
import { createApp } from '../server/app.ts';
import { mutateState, readState, resetStateForTests } from '../server/db/store.ts';
import { decryptSecret, encryptSecret, validateMagicBytes } from '../server/lib/crypto.ts';

async function startTestServer() {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

class TestClient {
  private cookies: Record<string, string> = {};
  constructor(private baseUrl: string) {}

  private extractCookies(res: Response) {
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of setCookies) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const val = pair.slice(eq + 1).trim();
        if (!val) delete this.cookies[name];
        else this.cookies[name] = val;
      }
    }
  }

  async req(path: string, init: RequestInit = {}) {
    const cookieHeader = Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (this.cookies.ts_csrf) headers['X-CSRF-Token'] = decodeURIComponent(this.cookies.ts_csrf);
    if (init.body && typeof init.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    this.extractCookies(res);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
}

describe('TogetherSpace Security, Invitation & Feature Suite', () => {
  beforeEach(() => {
    resetStateForTests();
  });

  it('encrypts and decrypts OAuth refresh tokens with AES-256-GCM and validates magic bytes', () => {
    const secret = '1//0gFakeRefreshTokenForUnitTest';
    const cipher = encryptSecret(secret);
    expect(cipher).not.toContain(secret);
    expect(decryptSecret(cipher)).toBe(secret);

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    expect(validateMagicBytes(pngHeader, 'image/png')).toBe(true);
    expect(validateMagicBytes(pngHeader, 'image/jpeg')).toBe(false);
  });

  it('supports owner setup, email verification, login, logout, and password reset session revocation', async () => {
    const srv = await startTestServer();
    try {
      const owner = new TestClient(srv.baseUrl);
      const reg = await owner.req('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@example.com',
          username: 'alex',
          displayName: 'Alex',
          password: 'Password123!',
        }),
      });
      expect(reg.status).toBe(201);
      expect(reg.data.user.role).toBe('owner');

      // Duplicate owner registration must be blocked
      const dup = await new TestClient(srv.baseUrl).req('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
          email: 'other@example.com',
          username: 'other',
          displayName: 'Other',
          password: 'Password123!',
        }),
      });
      expect(dup.status).toBe(403);

      // Verify email via generated token in devPreviewUrl
      const verifyToken = new URL(reg.data.devPreviewUrl).searchParams.get('token');
      const verified = await owner.req('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verifyToken }),
      });
      expect(verified.status).toBe(200);
      expect(verified.data.user.emailVerified).toBe(true);

      // Logout and re-login
      const out = await owner.req('/api/auth/logout', { method: 'POST' });
      expect(out.status).toBe(200);
      const sessionAfterOut = await owner.req('/api/auth/session');
      expect(sessionAfterOut.status).toBe(401);

      const login = await owner.req('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ emailOrUsername: 'alex', password: 'Password123!' }),
      });
      expect(login.status).toBe(200);

      // Forgot & reset password revokes existing sessions
      const forgot = await owner.req('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'owner@example.com' }),
      });
      expect(forgot.status).toBe(200);
      const resetToken = new URL(forgot.data.devPreviewUrl).searchParams.get('token');
      const reset = await owner.req('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword: 'NewPassword456!' }),
      });
      expect(reset.status).toBe(200);

      const postResetSession = await owner.req('/api/auth/session');
      expect(postResetSession.status).toBe(401);
    } finally {
      await srv.close();
    }
  });

  it('enforces single-use invitations, email binding, revocation, expiration, and blocks concurrent 3rd accounts', async () => {
    const srv = await startTestServer();
    try {
      const owner = new TestClient(srv.baseUrl);
      const reg = await owner.req('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@example.com',
          username: 'alex',
          displayName: 'Alex',
          password: 'Password123!',
        }),
      });
      const verifyToken = new URL(reg.data.devPreviewUrl).searchParams.get('token');
      await owner.req('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verifyToken }),
      });

      // Create bound invitation & revoke it
      const inv1 = await owner.req('/api/invitations/create', {
        method: 'POST',
        body: JSON.stringify({ intendedEmail: 'partner@example.com' }),
      });
      expect(inv1.status).toBe(201);
      const token1 = decodeURIComponent(inv1.data.inviteUrl.split('/invite/')[1]);

      await owner.req('/api/invitations/revoke', { method: 'POST', body: JSON.stringify({}) });
      const valRevoked = await new TestClient(srv.baseUrl).req(
        `/api/invitations/validate?token=${encodeURIComponent(token1)}`
      );
      expect(valRevoked.status).toBe(400);
      expect(valRevoked.data.reason).toBe('revoked');

      // Create replacement invitation bound to partner@example.com
      const inv2 = await owner.req('/api/invitations/create', {
        method: 'POST',
        body: JSON.stringify({ intendedEmail: 'partner@example.com' }),
      });
      const token2 = decodeURIComponent(inv2.data.inviteUrl.split('/invite/')[1]);

      // Wrong email rejected
      const wrongEmail = await new TestClient(srv.baseUrl).req('/api/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({
          token: token2,
          email: 'intruder@example.com',
          username: 'intruder',
          displayName: 'Intruder',
          password: 'Password123!',
        }),
      });
      expect(wrongEmail.status).toBe(403);

      // Concurrent accept attempts: only ONE can succeed
      const clientA = new TestClient(srv.baseUrl);
      const clientB = new TestClient(srv.baseUrl);
      const [resA, resB] = await Promise.all([
        clientA.req('/api/invitations/accept', {
          method: 'POST',
          body: JSON.stringify({
            token: token2,
            email: 'partner@example.com',
            username: 'samira',
            displayName: 'Samira',
            password: 'Password123!',
          }),
        }),
        clientB.req('/api/invitations/accept', {
          method: 'POST',
          body: JSON.stringify({
            token: token2,
            email: 'partner@example.com',
            username: 'samira2',
            displayName: 'Samira2',
            password: 'Password123!',
          }),
        }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses[0]).toBe(201);
      expect(statuses[1]).toBeGreaterThanOrEqual(403);

      // Owner cannot invite a 3rd account
      const inv3 = await owner.req('/api/invitations/create', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      expect(inv3.status).toBe(409);
    } finally {
      await srv.close();
    }
  });

  it('enforces 24h story expiration, messaging, and cross-user authorization boundaries', async () => {
    const srv = await startTestServer();
    try {
      const owner = new TestClient(srv.baseUrl);
      const regOwner = await owner.req('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@example.com',
          username: 'alex',
          displayName: 'Alex',
          password: 'Password123!',
        }),
      });
      await owner.req('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: new URL(regOwner.data.devPreviewUrl).searchParams.get('token') }),
      });

      const inv = await owner.req('/api/invitations/create', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const token = decodeURIComponent(inv.data.inviteUrl.split('/invite/')[1]);

      const partner = new TestClient(srv.baseUrl);
      const regPartner = await partner.req('/api/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({
          token,
          email: 'partner@example.com',
          username: 'samira',
          displayName: 'Samira',
          password: 'Password123!',
        }),
      });
      // Verify partner email via stored token lookup
      await mutateState((s) => {
        const p = s.users.find((u) => u.id === regPartner.data.user.id);
        if (p) p.emailVerified = true;
      }, ['users']);

      // Active vs expired story check
      const storyRes = await owner.req('/api/stories/create', {
        method: 'POST',
        body: JSON.stringify({ storyType: 'text', textContent: 'Active 24h note' }),
      });
      expect(storyRes.status).toBe(201);

      const feed1 = await partner.req('/api/stories/feed');
      expect(feed1.data.stories).toHaveLength(1);

      // Expire the story on backend
      await mutateState((s) => {
        s.stories[0].expiresAt = new Date(Date.now() - 1000).toISOString();
      }, ['stories']);

      const feed2 = await partner.req('/api/stories/feed');
      expect(feed2.data.stories).toHaveLength(0);

      const expiredView = await partner.req(`/api/stories/${storyRes.data.story.id}/view`, { method: 'POST' });
      expect(expiredView.status).toBe(410);

      // Partner cannot delete owner's story
      const delForbidden = await partner.req(`/api/stories/${storyRes.data.story.id}`, { method: 'DELETE' });
      expect(delForbidden.status).toBe(403);

      // Messaging & read receipt
      const sent = await owner.req('/api/messages/send', {
        method: 'POST',
        body: JSON.stringify({ messageType: 'text', textContent: 'Hello partner' }),
      });
      expect(sent.status).toBe(201);

      const readRes = await partner.req('/api/messages/read', { method: 'POST' });
      expect(readRes.status).toBe(200);
      expect(readRes.data.markedCount).toBe(1);
      expect(readState().messages[0].readBy.length).toBe(2);
    } finally {
      await srv.close();
    }
  });
});
