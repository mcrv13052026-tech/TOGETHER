import fs from 'fs';
import path from 'path';
import express from 'express';
import { env } from './server/config/env.ts';
import { initDatabase } from './server/db/store.ts';
import { createApp } from './server/app.ts';

async function startServer() {
  await initDatabase();
  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);

  if (env.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[TogetherSpace] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[TogetherSpace] Failed to start server:', err);
  process.exit(1);
});
