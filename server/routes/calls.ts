import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { mutateState, readState } from '../db/store.ts';
import type { CallRecord, NotificationItem } from '../db/types.ts';
import { type AuthenticatedRequest, getPartnerForUser, requireAuth, requireVerifiedEmail } from '../middleware/auth.ts';
import { publishRealtimeEvent } from '../services/realtime.ts';

export const callsRouter = express.Router();

callsRouter.get('/ice-config', requireAuth, requireVerifiedEmail, (_req, res) => {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  if (env.turnServerUrl && env.turnUsername && env.turnCredential) {
    iceServers.push({
      urls: env.turnServerUrl,
      username: env.turnUsername,
      credential: env.turnCredential,
    });
  }
  return res.json({
    iceServers,
    turnConfigured: Boolean(env.turnServerUrl && env.turnUsername && env.turnCredential),
  });
});

callsRouter.get('/history', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const history = readState()
    .calls.filter((c) => c.callerId === user.id || c.calleeId === user.id)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 40);
  return res.json({ calls: history });
});

callsRouter.post('/initiate', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    callType: z.enum(['audio', 'video']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid call type.' });

  const user = req.authUser!;
  const partner = getPartnerForUser(user.id);
  if (!partner) {
    return res.status(409).json({ error: 'Invite your partner before starting a call.' });
  }

  const now = new Date().toISOString();
  const call: CallRecord = {
    id: crypto.randomUUID(),
    callerId: user.id,
    calleeId: partner.id,
    callType: parsed.data.callType,
    status: 'ringing',
    startedAt: now,
    answeredAt: null,
    endedAt: null,
    durationSeconds: 0,
  };

  await mutateState((state) => {
    state.calls.unshift(call);
  }, ['calls']);

  void publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'call:incoming',
    data: {
      call,
      caller: {
        id: user.id,
        displayName: user.displayName,
        username: user.username,
        avatarMediaId: user.avatarMediaId,
      },
    },
    targetUserIds: [partner.id],
  });

  return res.status(201).json({ call });
});

callsRouter.post('/signal', requireAuth, requireVerifiedEmail, (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    callId: z.string().min(1),
    signalType: z.enum(['offer', 'answer', 'ice-candidate', 'hangup', 'reject', 'accept']),
    payload: z.unknown().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid signaling payload.' });

  const user = req.authUser!;
  const call = readState().calls.find((c) => c.id === parsed.data.callId);
  if (!call || (call.callerId !== user.id && call.calleeId !== user.id)) {
    return res.status(403).json({ error: 'Unauthorized call signaling attempt.' });
  }

  const targetId = call.callerId === user.id ? call.calleeId : call.callerId;
  void publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'call:signal',
    data: {
      callId: call.id,
      fromUserId: user.id,
      signalType: parsed.data.signalType,
      payload: parsed.data.payload,
    },
    targetUserIds: [targetId],
  });

  return res.json({ ok: true });
});

callsRouter.post('/:id/status', requireAuth, requireVerifiedEmail, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    status: z.enum(['active', 'ended', 'missed', 'rejected']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid call status.' });

  const user = req.authUser!;
  const callId = String(req.params.id);
  const now = new Date();

  const outcome = await mutateState((state) => {
    const call = state.calls.find((c) => c.id === callId);
    if (!call) return { error: 'Call record not found.', status: 404 as const };
    if (call.callerId !== user.id && call.calleeId !== user.id) {
      return { error: 'Not authorized to update this call.', status: 403 as const };
    }

    call.status = parsed.data.status;
    if (parsed.data.status === 'active' && !call.answeredAt) {
      call.answeredAt = now.toISOString();
    }
    if (parsed.data.status === 'ended' || parsed.data.status === 'missed' || parsed.data.status === 'rejected') {
      call.endedAt = now.toISOString();
      if (call.answeredAt) {
        call.durationSeconds = Math.max(
          0,
          Math.round((now.getTime() - new Date(call.answeredAt).getTime()) / 1000)
        );
      }
    }

    let missedNotification: NotificationItem | null = null;
    if (parsed.data.status === 'missed') {
      const caller = state.users.find((u) => u.id === call.callerId);
      missedNotification = {
        id: crypto.randomUUID(),
        recipientId: call.calleeId,
        actorId: call.callerId,
        type: 'call_missed',
        title: `Missed ${call.callType} call`,
        body: `You missed a ${call.callType} call from ${caller?.displayName || 'your partner'}.`,
        link: '/messages',
        read: false,
        createdAt: now.toISOString(),
      };
      state.notifications.unshift(missedNotification);
    }

    return { call, missedNotification };
  }, ['calls', 'notifications']);

  if ('error' in outcome) return res.status(outcome.status as number).json({ error: outcome.error });

  void publishRealtimeEvent({
    channel: 'togetherspace-private',
    event: 'call:status',
    data: outcome.call,
  });

  if (outcome.missedNotification) {
    void publishRealtimeEvent({
      channel: 'togetherspace-private',
      event: 'notification:new',
      data: outcome.missedNotification,
      targetUserIds: [outcome.call.calleeId],
    });
  }

  return res.json({ call: outcome.call });
});
