import { env } from '../config/env.ts';

export interface DevEmailRecord {
  id: string;
  to: string;
  subject: string;
  actionUrl?: string;
  sentAt: string;
  provider: 'resend' | 'dev-preview';
}

const devOutbox: DevEmailRecord[] = [];

export function getDevOutboxForRecipient(email?: string): DevEmailRecord[] {
  if (env.isProd) return [];
  if (!email) return devOutbox.slice(0, 10);
  const normalized = email.toLowerCase().trim();
  return devOutbox.filter((item) => item.to.toLowerCase() === normalized).slice(0, 10);
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  actionUrl?: string;
}): Promise<{ delivered: boolean; provider: 'resend' | 'dev-preview'; previewUrl?: string }> {
  if (env.resendApiKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.emailFrom,
          to: [params.to],
          subject: params.subject,
          html: params.html,
          text: params.text,
        }),
      });
      if (!response.ok) {
        const errBody = await response.text();
        console.error('[Email] Resend delivery failed:', response.status, errBody);
        return { delivered: false, provider: 'resend' };
      }
      return { delivered: true, provider: 'resend' };
    } catch (err) {
      console.error('[Email] Resend network error:', err);
      return { delivered: false, provider: 'resend' };
    }
  }

  // Non-production dev preview fallback when RESEND_API_KEY is not configured
  const record: DevEmailRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    to: params.to,
    subject: params.subject,
    actionUrl: env.isProd ? undefined : params.actionUrl,
    sentAt: new Date().toISOString(),
    provider: 'dev-preview',
  };
  devOutbox.unshift(record);
  if (devOutbox.length > 25) devOutbox.length = 25;

  return {
    delivered: true,
    provider: 'dev-preview',
    previewUrl: env.isProd ? undefined : params.actionUrl,
  };
}
