import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Ephemeral fallback secrets for local development only when env vars are unset.
// Never exposed to browser; in production, explicit secrets are strongly recommended.
const DEV_FALLBACK_JWT = crypto.randomBytes(32).toString('hex');
const DEV_FALLBACK_SESSION = crypto.randomBytes(32).toString('hex');
const DEV_FALLBACK_ENC = crypto.createHash('sha256').update(process.cwd() + ':ts-dev-enc').digest('hex');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  apiBaseUrl: process.env.API_BASE_URL || process.env.APP_URL || 'http://localhost:3000',

  jwtSecret: process.env.JWT_SECRET || DEV_FALLBACK_JWT,
  sessionSecret: process.env.SESSION_SECRET || DEV_FALLBACK_SESSION,
  encryptionKey: process.env.ENCRYPTION_KEY || DEV_FALLBACK_ENC,

  mongodbUri: process.env.MONGODB_URI?.trim() || '',

  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || '',
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `${process.env.APP_URL || 'http://localhost:3000'}/api/google/callback`,

  ablyApiKey: process.env.ABLY_API_KEY?.trim() || '',
  resendApiKey: process.env.RESEND_API_KEY?.trim() || '',
  emailFrom: process.env.EMAIL_FROM?.trim() || 'TogetherSpace <noreply@togetherspace.local>',

  turnServerUrl: process.env.TURN_SERVER_URL?.trim() || '',
  turnUsername: process.env.TURN_USERNAME?.trim() || '',
  turnCredential: process.env.TURN_CREDENTIAL?.trim() || '',

  cronSecret: process.env.CRON_SECRET?.trim() || '',
  privacyContactEmail: process.env.PRIVACY_CONTACT_EMAIL?.trim() || 'privacy@example.com',
};

export function getCapabilities() {
  return {
    database: env.mongodbUri ? 'mongodb' : 'local-persistent',
    googleDriveConfigured: Boolean(env.googleClientId && env.googleClientSecret),
    ablyConfigured: Boolean(env.ablyApiKey),
    emailConfigured: Boolean(env.resendApiKey),
    turnConfigured: Boolean(env.turnServerUrl && env.turnUsername && env.turnCredential),
    privacyContactEmail: env.privacyContactEmail,
  };
}
