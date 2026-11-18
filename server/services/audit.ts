import crypto from 'crypto';
import { mutateState } from '../db/store.ts';
import type { ActivityItem, AuditLog } from '../db/types.ts';

export async function recordAuditLog(params: {
  userId: string | null;
  action: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const safeMeta = { ...(params.metadata || {}) };
  for (const sensitiveKey of ['password', 'token', 'refreshToken', 'accessToken', 'secret', 'textContent']) {
    if (sensitiveKey in safeMeta) {
      delete safeMeta[sensitiveKey];
    }
  }

  const entry: AuditLog = {
    id: crypto.randomUUID(),
    userId: params.userId,
    action: params.action,
    ipAddress: params.ipAddress || 'unknown',
    userAgent: (params.userAgent || '').slice(0, 200),
    metadata: safeMeta,
    createdAt: new Date().toISOString(),
  };

  await mutateState((state) => {
    state.auditLogs.unshift(entry);
    if (state.auditLogs.length > 500) {
      state.auditLogs = state.auditLogs.slice(0, 500);
    }
  }, ['auditLogs']);
}

export async function recordActivity(params: {
  userId: string;
  summary: string;
  category: ActivityItem['category'];
}): Promise<void> {
  const entry: ActivityItem = {
    id: crypto.randomUUID(),
    userId: params.userId,
    summary: params.summary,
    category: params.category,
    createdAt: new Date().toISOString(),
  };

  await mutateState((state) => {
    state.activities.unshift(entry);
    if (state.activities.length > 100) {
      state.activities = state.activities.slice(0, 100);
    }
  }, ['activities']);
}
