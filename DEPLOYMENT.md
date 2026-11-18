# TogetherSpace — Setup & Vercel Deployment Guide

## 1. Required External Services & Credentials

1. **MongoDB Atlas (Database)**
   - Create a free M0 cluster on MongoDB Atlas.
   - Configure a least-privilege database user and network access allowlist.
   - Set `MONGODB_URI` in `.env` / Vercel Environment Variables.
   - *(Note: When `MONGODB_URI` is omitted locally, TogetherSpace runs with an atomic local JSON store in `data/togetherspace.db.json` and private local vault in `data/vault/` so you can develop and test immediately.)*

2. **Google Cloud Console (Personal Google Drive OAuth 2.0)**
   - Enable the **Google Drive API**.
   - Configure an OAuth Consent Screen and create a **Web Application** OAuth 2.0 Client.
   - Add authorized redirect URIs:
     - Local: `http://localhost:3000/api/google/callback`
     - Production: `https://<your-vercel-domain>/api/google/callback`
   - Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.

3. **Ably (Real-time Messaging & WebRTC Signaling)**
   - Create an Ably app and copy the API key (`ABLY_API_KEY`).
   - *(Locally without `ABLY_API_KEY`, TogetherSpace uses built-in authenticated Server-Sent Events at `/api/realtime/stream`.)*

4. **TURN Server (WebRTC NAT Traversal)**
   - Provision credentials from a managed TURN provider (e.g., Metered, Twilio NTS, or Cloudflare Calls) for reliable voice/video calls across symmetric NATs/mobile networks.
   - Set `TURN_SERVER_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL`.

5. **Resend (Optional Transactional Emails)**
   - Verify a sending domain in Resend and set `RESEND_API_KEY` and `EMAIL_FROM`.

6. **Security Secrets**
   - Generate 32+ byte random secrets for `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, and `CRON_SECRET`.

---

## 2. Local Development (Windows PowerShell & VS Code)

Open the project folder in VS Code and run in **Windows PowerShell**:

```powershell
# 1. Copy environment template
Copy-Item .env.example .env

# 2. Install dependencies
npm install

# 3. Run typecheck and automated security/invitation tests
npm run lint
npm test

# 4. Start the development server on http://localhost:3000
npm run dev
```

---

## 3. Deploying to Vercel

1. Push the repository to GitHub (ensure `.env` and `data/` are gitignored and never committed).
2. Import the repository in **Vercel**.
3. Configure all production environment variables (`MONGODB_URI`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `ABLY_API_KEY`, `TURN_SERVER_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`, `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, `PRIVACY_CONTACT_EMAIL`).
4. Deploy. `vercel.json` routes `/api/*` to the serverless handler at `api/index.ts`, serves the Vite build from `dist/`, and schedules the hourly `/api/cron/cleanup-stories` job.
