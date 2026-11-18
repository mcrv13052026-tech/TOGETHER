import type { Response } from 'express';
import { env } from '../config/env.ts';

interface SseClient {
  id: string;
  userId: string;
  res: Response;
  connectedAt: string;
}

const clients = new Map<string, SseClient>();
const onlineUsers = new Map<string, number>();

export function registerSseClient(clientId: string, userId: string, res: Response): void {
  clients.set(clientId, {
    id: clientId,
    userId,
    res,
    connectedAt: new Date().toISOString(),
  });
  onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1);
  broadcastPresence(userId, true);
}

export function unregisterSseClient(clientId: string): void {
  const existing = clients.get(clientId);
  if (!existing) return;
  clients.delete(clientId);
  const count = Math.max(0, (onlineUsers.get(existing.userId) || 1) - 1);
  if (count === 0) {
    onlineUsers.delete(existing.userId);
    broadcastPresence(existing.userId, false);
  } else {
    onlineUsers.set(existing.userId, count);
  }
}

export function isUserOnline(userId: string): boolean {
  return (onlineUsers.get(userId) || 0) > 0;
}

export function getOnlineUserIds(): string[] {
  return Array.from(onlineUsers.keys());
}

function broadcastPresence(userId: string, online: boolean) {
  void publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'presence',
    data: { userId, online, timestamp: new Date().toISOString() },
  });
}

export async function publishRealtimeEvent(params: {
  channel: string;
  event: string;
  data: unknown;
  targetUserIds?: string[];
}): Promise<void> {
  // 1. Push to connected SSE clients immediately
  const payload = `event: ${params.event}\ndata: ${JSON.stringify(params.data)}\n\n`;
  for (const client of clients.values()) {
    if (params.targetUserIds && !params.targetUserIds.includes(client.userId)) {
      continue;
    }
    try {
      client.res.write(payload);
    } catch {
      unregisterSseClient(client.id);
    }
  }

  // 2. Also publish to Ably REST when ABLY_API_KEY is configured
  if (env.ablyApiKey) {
    try {
      const authHeader = 'Basic ' + Buffer.from(env.ablyApiKey).toString('base64');
      await fetch(`https://rest.ably.io/channels/${encodeURIComponent(params.channel)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: params.event, data: params.data }),
      });
    } catch (err) {
      console.error('[Realtime] Ably publish error:', err);
    }
  }
}
