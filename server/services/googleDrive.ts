import crypto from 'crypto';
import { env } from '../config/env.ts';
import { mutateState, readState } from '../db/store.ts';
import type { GoogleAccount } from '../db/types.ts';
import { createPkceChallenge, decryptSecret, encryptSecret, generateRandomToken } from '../lib/crypto.ts';

interface PendingOAuthState {
  userId: string;
  codeVerifier: string;
  createdAt: number;
}

const pendingOAuthStates = new Map<string, PendingOAuthState>();

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function isGoogleDriveOAuthConfigured(): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret);
}

export function createGoogleAuthUrl(userId: string, originRedirectUri?: string): { url: string; state: string } {
  if (!isGoogleDriveOAuthConfigured()) {
    throw new Error('Google OAuth client credentials are not configured on the server.');
  }
  const state = generateRandomToken(24);
  const codeVerifier = generateRandomToken(48);
  const codeChallenge = createPkceChallenge(codeVerifier);

  // Clean stale states older than 15 minutes
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, val] of pendingOAuthStates.entries()) {
    if (val.createdAt < cutoff) pendingOAuthStates.delete(key);
  }

  pendingOAuthStates.set(state, { userId, codeVerifier, createdAt: Date.now() });

  const redirectUri = originRedirectUri || env.googleRedirectUri;
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state,
  };
}

export function consumeGoogleOAuthState(state: string): PendingOAuthState | null {
  const record = pendingOAuthStates.get(state);
  if (!record) return null;
  pendingOAuthStates.delete(state);
  if (Date.now() - record.createdAt > 15 * 60 * 1000) return null;
  return record;
}

export async function exchangeGoogleAuthCode(params: {
  userId: string;
  code: string;
  codeVerifier: string;
  redirectUri?: string;
}): Promise<GoogleAccount> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri || env.googleRedirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${text}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  // Fetch user email
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userInfo = userInfoRes.ok ? ((await userInfoRes.json()) as { email?: string }) : {};

  // Ensure private TogetherSpace folder in user's Drive
  const driveFolderId = await ensurePrivateDriveFolder(tokenData.access_token);
  const quota = await fetchDriveQuotaWithAccessToken(tokenData.access_token);

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

  return mutateState((state) => {
    const existing = state.googleAccounts.find((g) => g.userId === params.userId);
    const refreshCipher = tokenData.refresh_token
      ? encryptSecret(tokenData.refresh_token)
      : existing?.encryptedRefreshToken || '';

    if (!refreshCipher) {
      throw new Error('Google did not return a refresh token. Please revoke and reconnect with consent.');
    }

    const updated: GoogleAccount = {
      id: existing?.id || crypto.randomUUID(),
      userId: params.userId,
      googleEmail: userInfo.email || existing?.googleEmail || 'Connected Google Account',
      encryptedRefreshToken: refreshCipher,
      accessTokenEncrypted: encryptSecret(tokenData.access_token),
      accessTokenExpiresAt: expiresAt,
      grantedScopes: tokenData.scope ? tokenData.scope.split(' ') : GOOGLE_SCOPES,
      connectionStatus: 'connected',
      driveFolderId,
      lastQuotaBytesTotal: quota?.limit ?? null,
      lastQuotaBytesUsed: quota?.usage ?? null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const idx = state.googleAccounts.findIndex((g) => g.userId === params.userId);
    if (idx >= 0) state.googleAccounts[idx] = updated;
    else state.googleAccounts.push(updated);
    return updated;
  }, ['googleAccounts']);
}

async function getValidGoogleAccessToken(userId: string): Promise<{ accessToken: string; account: GoogleAccount } | null> {
  const account = readState().googleAccounts.find((g) => g.userId === userId);
  if (!account || account.connectionStatus !== 'connected') return null;

  if (
    account.accessTokenEncrypted &&
    account.accessTokenExpiresAt &&
    new Date(account.accessTokenExpiresAt).getTime() > Date.now() + 60_000
  ) {
    try {
      return { accessToken: decryptSecret(account.accessTokenEncrypted), account };
    } catch {
      // fall through to refresh
    }
  }

  let refreshToken = '';
  try {
    refreshToken = decryptSecret(account.encryptedRefreshToken);
  } catch {
    return null;
  }

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!refreshRes.ok) {
    await mutateState((state) => {
      const target = state.googleAccounts.find((g) => g.userId === userId);
      if (target) {
        target.connectionStatus = refreshRes.status === 400 ? 'revoked' : 'expired';
        target.updatedAt = new Date().toISOString();
      }
    }, ['googleAccounts']);
    return null;
  }

  const data = (await refreshRes.json()) as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

  const updated = await mutateState((state) => {
    const target = state.googleAccounts.find((g) => g.userId === userId);
    if (!target) return null;
    target.accessTokenEncrypted = encryptSecret(data.access_token);
    target.accessTokenExpiresAt = expiresAt;
    target.connectionStatus = 'connected';
    target.updatedAt = new Date().toISOString();
    return target;
  }, ['googleAccounts']);

  return updated ? { accessToken: data.access_token, account: updated } : null;
}

async function ensurePrivateDriveFolder(accessToken: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(
      "name='TogetherSpace Private Vault' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (searchRes.ok) {
      const found = (await searchRes.json()) as { files?: { id: string }[] };
      if (found.files && found.files.length > 0) {
        return found.files[0].id;
      }
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'TogetherSpace Private Vault',
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (createRes.ok) {
      const created = (await createRes.json()) as { id: string };
      return created.id;
    }
  } catch (err) {
    console.error('[GoogleDrive] Folder check error:', err);
  }
  return null;
}

async function fetchDriveQuotaWithAccessToken(accessToken: string): Promise<{ limit: number | null; usage: number | null } | null> {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { storageQuota?: { limit?: string; usage?: string } };
    const limit = json.storageQuota?.limit ? Number(json.storageQuota.limit) : null;
    const usage = json.storageQuota?.usage ? Number(json.storageQuota.usage) : null;
    return { limit, usage };
  } catch {
    return null;
  }
}

export async function refreshAndGetGoogleQuota(userId: string): Promise<{ limit: number | null; usage: number | null } | null> {
  const valid = await getValidGoogleAccessToken(userId);
  if (!valid) return null;
  const quota = await fetchDriveQuotaWithAccessToken(valid.accessToken);
  if (quota) {
    await mutateState((state) => {
      const acc = state.googleAccounts.find((g) => g.userId === userId);
      if (acc) {
        acc.lastQuotaBytesTotal = quota.limit;
        acc.lastQuotaBytesUsed = quota.usage;
        acc.updatedAt = new Date().toISOString();
      }
    }, ['googleAccounts']);
  }
  return quota;
}

export async function uploadBufferToGoogleDrive(params: {
  userId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ fileId: string } | null> {
  const valid = await getValidGoogleAccessToken(params.userId);
  if (!valid) return null;

  const folderId = valid.account.driveFolderId || (await ensurePrivateDriveFolder(valid.accessToken));
  const metadata = {
    name: params.filename,
    parents: folderId ? [folderId] : undefined,
  };

  const boundary = `ts_boundary_${crypto.randomBytes(8).toString('hex')}`;
  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  );
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`
  );
  const closing = Buffer.from(`\r\n--${boundary}--`);
  const multipartBody = Buffer.concat([metaPart, fileHeader, params.buffer, closing]);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${valid.accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive upload failed (${res.status}): ${errText}`);
  }
  const json = (await res.json()) as { id: string };
  return { fileId: json.id };
}

export async function streamFileFromGoogleDrive(params: {
  ownerUserId: string;
  driveFileId: string;
  rangeHeader?: string;
}): Promise<globalThis.Response | null> {
  const valid = await getValidGoogleAccessToken(params.ownerUserId);
  if (!valid) return null;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${valid.accessToken}`,
  };
  if (params.rangeHeader) {
    headers.Range = params.rangeHeader;
  }

  return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(params.driveFileId)}?alt=media`, {
    headers,
  });
}

export async function deleteFileFromGoogleDrive(ownerUserId: string, driveFileId: string): Promise<boolean> {
  const valid = await getValidGoogleAccessToken(ownerUserId);
  if (!valid) return false;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${valid.accessToken}` },
  });
  return res.ok || res.status === 404;
}
