import express from 'express';
import { mutateState, readState } from '../db/store.ts';
import { type AuthenticatedRequest, requireAuth } from '../middleware/auth.ts';
import { recordActivity, recordAuditLog } from '../services/audit.ts';
import {
  consumeGoogleOAuthState,
  createGoogleAuthUrl,
  exchangeGoogleAuthCode,
  isGoogleDriveOAuthConfigured,
  refreshAndGetGoogleQuota,
} from '../services/googleDrive.ts';

export const googleRouter = express.Router();

googleRouter.get('/connect', requireAuth, (req: AuthenticatedRequest, res) => {
  if (!isGoogleDriveOAuthConfigured()) {
    return res.status(503).json({
      error: 'Google Drive OAuth is not configured on this server. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in environment variables.',
      configured: false,
      requiredEnv: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
    });
  }

  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/google/callback`;
    const { url } = createGoogleAuthUrl(req.authUser!.id, redirectUri);
    return res.json({ url, configured: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

googleRouter.get('/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  const errorParam = typeof req.query.error === 'string' ? req.query.error : '';

  if (errorParam) {
    return res.redirect(`/settings?google_error=${encodeURIComponent(errorParam)}`);
  }

  const pending = consumeGoogleOAuthState(stateParam);
  if (!pending || !code) {
    return res.redirect('/settings?google_error=invalid_or_expired_state');
  }

  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/google/callback`;
    const account = await exchangeGoogleAuthCode({
      userId: pending.userId,
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri,
    });

    await recordAuditLog({
      userId: pending.userId,
      action: 'google_drive.connected',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { googleEmail: account.googleEmail },
    });
    await recordActivity({
      userId: pending.userId,
      summary: `Connected personal Google Drive (${account.googleEmail})`,
      category: 'drive',
    });

    return res.redirect('/settings?google=connected');
  } catch (err) {
    console.error('[GoogleOAuth] Callback failure:', err);
    return res.redirect('/settings?google_error=token_exchange_failed');
  }
});

googleRouter.post('/disconnect', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  await mutateState((state) => {
    state.googleAccounts = state.googleAccounts.filter((g) => g.userId !== user.id);
  }, ['googleAccounts']);

  await recordAuditLog({
    userId: user.id,
    action: 'google_drive.disconnected',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({
    ok: true,
    message: 'Google Drive disconnected and stored OAuth tokens removed. Your files inside Google Drive were not deleted.',
  });
});

googleRouter.get('/storage', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const state = readState();
  const googleAccount = state.googleAccounts.find((g) => g.userId === user.id);

  let quota: { limit: number | null; usage: number | null } | null = null;
  if (googleAccount && googleAccount.connectionStatus === 'connected') {
    quota = await refreshAndGetGoogleQuota(user.id);
  }

  const ownMedia = state.media.filter((m) => m.ownerId === user.id);
  const togetherSpaceBytes = ownMedia.reduce((sum, m) => sum + (m.fileSize || 0), 0);
  const driveBytes = ownMedia
    .filter((m) => m.storageProvider === 'google_drive')
    .reduce((sum, m) => sum + (m.fileSize || 0), 0);
  const vaultBytes = ownMedia
    .filter((m) => m.storageProvider === 'local_vault')
    .reduce((sum, m) => sum + (m.fileSize || 0), 0);

  return res.json({
    oauthConfigured: isGoogleDriveOAuthConfigured(),
    connected: googleAccount?.connectionStatus === 'connected',
    status: googleAccount?.connectionStatus || 'disconnected',
    googleEmail: googleAccount?.googleEmail || null,
    grantedScopes: googleAccount?.grantedScopes || [],
    quotaTotalBytes: quota?.limit ?? googleAccount?.lastQuotaBytesTotal ?? null,
    quotaUsedBytes: quota?.usage ?? googleAccount?.lastQuotaBytesUsed ?? null,
    togetherSpaceUsageBytes: togetherSpaceBytes,
    driveStoredBytes: driveBytes,
    localVaultBytes: vaultBytes,
    mediaCount: ownMedia.length,
    quotaNote: 'Google Account storage may be shared across Google Drive, Gmail, and Google Photos.',
  });
});
