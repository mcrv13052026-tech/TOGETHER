import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express from 'express';
import multer from 'multer';
import { mutateState, readState, VAULT_DIR } from '../db/store.ts';
import type { MediaItem, MediaKind } from '../db/types.ts';
import { validateMagicBytes } from '../lib/crypto.ts';
import {
  type AuthenticatedRequest,
  getActiveApprovedUsers,
  requireAuth,
  requireVerifiedEmail,
} from '../middleware/auth.ts';
import { recordAuditLog } from '../services/audit.ts';
import {
  deleteFileFromGoogleDrive,
  streamFileFromGoogleDrive,
  uploadBufferToGoogleDrive,
} from '../services/googleDrive.ts';

export const mediaRouter = express.Router();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function inferMediaKind(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  return 'audio';
}

mediaRouter.post('/upload', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File exceeds the 50 MB upload limit.' });
      }
      return res.status(400).json({ error: 'Invalid upload payload.' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No media file provided.' });
    }

    const mime = file.mimetype.toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      return res.status(415).json({ error: `Unsupported file type (${mime}).` });
    }

    if (!validateMagicBytes(file.buffer, mime)) {
      return res.status(400).json({ error: 'File contents do not match the declared media type.' });
    }

    const user = req.authUser!;
    const mediaId = crypto.randomUUID();
    const safeExt = path.extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10) || '.bin';
    const serverFilename = `${mediaId}${safeExt}`;
    const durationSeconds = req.body?.durationSeconds ? Number(req.body.durationSeconds) : null;

    let storageProvider: MediaItem['storageProvider'] = 'local_vault';
    let googleDriveFileId: string | null = null;
    let localFilename: string | null = null;

    const googleAccount = readState().googleAccounts.find(
      (g) => g.userId === user.id && g.connectionStatus === 'connected'
    );

    if (googleAccount) {
      try {
        const uploaded = await uploadBufferToGoogleDrive({
          userId: user.id,
          buffer: file.buffer,
          filename: serverFilename,
          mimeType: mime,
        });
        if (uploaded) {
          storageProvider = 'google_drive';
          googleDriveFileId = uploaded.fileId;
        }
      } catch (driveErr) {
        console.error('[MediaUpload] Drive upload failed, falling back to private vault:', driveErr);
      }
    }

    if (storageProvider === 'local_vault') {
      if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
      fs.writeFileSync(path.join(VAULT_DIR, serverFilename), file.buffer);
      localFilename = serverFilename;
    }

    const activeUsers = getActiveApprovedUsers();
    const allowedViewerIds = activeUsers.map((u) => u.id);

    const mediaItem: MediaItem = {
      id: mediaId,
      ownerId: user.id,
      storageProvider,
      googleDriveFileId,
      localFilename,
      originalName: (file.originalname || 'media').slice(0, 120),
      mimeType: mime,
      fileSize: file.size,
      mediaType: inferMediaKind(mime),
      width: null,
      height: null,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      thumbnailMediaId: null,
      allowedViewerIds,
      albumIds: [],
      createdAt: new Date().toISOString(),
    };

    await mutateState((state) => {
      state.media.push(mediaItem);
    }, ['media']);

    await recordAuditLog({
      userId: user.id,
      action: 'media.uploaded',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { mediaId, mediaType: mediaItem.mediaType, storageProvider, fileSize: file.size },
    });

    return res.status(201).json({
      media: {
        id: mediaItem.id,
        mediaType: mediaItem.mediaType,
        mimeType: mediaItem.mimeType,
        fileSize: mediaItem.fileSize,
        storageProvider: mediaItem.storageProvider,
        durationSeconds: mediaItem.durationSeconds,
        url: `/api/media/stream/${mediaItem.id}`,
        createdAt: mediaItem.createdAt,
      },
    });
  });
});

mediaRouter.get('/stream/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const mediaId = String(req.params.id);
  const media = readState().media.find((m) => m.id === mediaId);

  if (!media) {
    return res.status(404).json({ error: 'Media item not found.' });
  }

  // Strict authorization check: prevent IDOR and unauthorized access
  if (media.ownerId !== user.id && !media.allowedViewerIds.includes(user.id)) {
    return res.status(403).json({ error: 'You are not authorized to view this private media.' });
  }

  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Accept-Ranges', 'bytes');

  if (media.storageProvider === 'google_drive' && media.googleDriveFileId) {
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const driveRes = await streamFileFromGoogleDrive({
      ownerUserId: media.ownerId,
      driveFileId: media.googleDriveFileId,
      rangeHeader,
    });

    if (!driveRes || !driveRes.ok) {
      return res.status(502).json({
        error: 'Unable to retrieve media from the owner’s Google Drive. The Drive connection may need to be reauthorized.',
      });
    }

    res.status(driveRes.status);
    res.setHeader('Content-Type', media.mimeType);
    const contentLength = driveRes.headers.get('content-length');
    const contentRange = driveRes.headers.get('content-range');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const arrayBuf = await driveRes.arrayBuffer();
    return res.send(Buffer.from(arrayBuf));
  }

  if (!media.localFilename) {
    return res.status(404).json({ error: 'Stored media file is missing.' });
  }

  // Prevent path traversal strictly
  const safeName = path.basename(media.localFilename);
  const filePath = path.join(VAULT_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Stored media file is missing.' });
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    if (Number.isNaN(start) || start >= total || end >= total) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`);
      return res.end();
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': media.mimeType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': total,
    'Content-Type': media.mimeType,
  });
  fs.createReadStream(filePath).pipe(res);
});

mediaRouter.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const mediaId = String(req.params.id);
  const deleteFromDrive = req.query.deleteFromDrive === 'true';

  const media = readState().media.find((m) => m.id === mediaId);
  if (!media) return res.status(404).json({ error: 'Media item not found.' });
  if (media.ownerId !== user.id) {
    return res.status(403).json({ error: 'Only the media owner can delete this item.' });
  }

  if (media.storageProvider === 'google_drive' && media.googleDriveFileId && deleteFromDrive) {
    await deleteFileFromGoogleDrive(user.id, media.googleDriveFileId);
  }
  if (media.storageProvider === 'local_vault' && media.localFilename) {
    const safePath = path.join(VAULT_DIR, path.basename(media.localFilename));
    if (fs.existsSync(safePath)) fs.unlinkSync(safePath);
  }

  await mutateState((state) => {
    state.media = state.media.filter((m) => m.id !== mediaId);
  }, ['media']);

  await recordAuditLog({
    userId: user.id,
    action: 'media.deleted',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    metadata: { mediaId, deleteFromDrive },
  });

  return res.json({ ok: true });
});
