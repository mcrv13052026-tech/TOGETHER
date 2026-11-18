import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.ts';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function deriveAesKey(): Buffer {
  return crypto.createHash('sha256').update(env.encryptionKey).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = deriveAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = deriveAesKey();
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export interface SessionJwtPayload {
  sub: string;
  sid: string;
  role: 'owner' | 'partner';
  iat: number;
  exp: number;
}

function b64UrlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

export function signSessionJwt(payload: Omit<SessionJwtPayload, 'iat' | 'exp'>, ttlSeconds = 60 * 60 * 24 * 7): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: SessionJwtPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };
  const headerB64 = b64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payloadB64 = b64UrlJson(fullPayload);
  const sig = crypto
    .createHmac('sha256', env.jwtSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${sig}`;
}

export function verifySessionJwt(token: string): SessionJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const expectedSig = crypto
      .createHmac('sha256', env.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    if (!safeEqual(sigB64, expectedSig)) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionJwtPayload;
    if (!payload.sub || !payload.sid || !payload.exp) return null;
    if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createPkceChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function validateMagicBytes(buffer: Buffer, claimedMime: string): boolean {
  if (buffer.length < 4) return false;
  const hex = buffer.subarray(0, 12).toString('hex').toLowerCase();

  if (claimedMime === 'image/jpeg' || claimedMime === 'image/jpg') {
    return hex.startsWith('ffd8ff');
  }
  if (claimedMime === 'image/png') {
    return hex.startsWith('89504e470d0a1a0a');
  }
  if (claimedMime === 'image/gif') {
    return hex.startsWith('474946383761') || hex.startsWith('474946383961');
  }
  if (claimedMime === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (claimedMime === 'video/mp4' || claimedMime === 'video/quicktime') {
    return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  if (claimedMime === 'video/webm' || claimedMime === 'audio/webm') {
    return hex.startsWith('1a45dfa3');
  }
  if (claimedMime === 'audio/mpeg' || claimedMime === 'audio/mp3') {
    return hex.startsWith('494433') || hex.startsWith('fffb') || hex.startsWith('fff3') || hex.startsWith('fff2');
  }
  if (claimedMime === 'audio/wav' || claimedMime === 'audio/wave') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
  }
  if (claimedMime === 'audio/ogg') {
    return buffer.subarray(0, 4).toString('ascii') === 'OggS';
  }
  if (claimedMime === 'audio/mp4' || claimedMime === 'audio/m4a') {
    return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  return false;
}
