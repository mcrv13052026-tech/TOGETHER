import type { Request, Response } from 'express';
import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/store.ts';

let initialized = false;
const app = createApp();

export default async function handler(req: Request, res: Response) {
  if (!initialized) {
    await initDatabase();
    initialized = true;
  }
  return app(req, res);
}
