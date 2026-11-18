import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { env, getCapabilities } from './config/env.ts';
import { mutateState } from './db/store.ts';
import { ensureCsrfCookie, securityHeadersMiddleware, verifyCsrf } from './middleware/auth.ts';
import { albumsRouter } from './routes/albums.ts';
import { authRouter } from './routes/auth.ts';
import { callsRouter } from './routes/calls.ts';
import { googleRouter } from './routes/google.ts';
import { connectionRouter, invitationsRouter } from './routes/invitations.ts';
import { mediaRouter } from './routes/media.ts';
import { messagesRouter } from './routes/messages.ts';
import { postsRouter } from './routes/posts.ts';
import { notificationsRouter, privacyRouter, profileRouter, realtimeRouter } from './routes/privacy.ts';
import { reelsRouter } from './routes/reels.ts';
import { storiesRouter } from './routes/stories.ts';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(securityHeadersMiddleware);
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(ensureCsrfCookie);
  app.use(verifyCsrf);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'TogetherSpace',
      capabilities: getCapabilities(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/cron/cleanup-stories', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    if (env.cronSecret && authHeader !== `Bearer ${env.cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized cron execution.' });
    }
    const now = Date.now();
    let archivedCount = 0;
    await mutateState((state) => {
      for (const s of state.stories) {
        if (!s.archived && new Date(s.expiresAt).getTime() <= now) {
          s.archived = true;
          archivedCount += 1;
        }
      }
    }, ['stories']);
    return res.json({ ok: true, archivedCount });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/invitations', invitationsRouter);
  app.use('/api/connection', connectionRouter);
  app.use('/api/google', googleRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/reels', reelsRouter);
  app.use('/api/stories', storiesRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/albums', albumsRouter);
  app.use('/api/calls', callsRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/privacy', privacyRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/realtime', realtimeRouter);

  // Unknown API route handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Safe global error handler — never leak stack traces or secrets
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[ServerError]', err.message);
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  });

  return app;
}
