import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function PrivacyPolicyPage() {
  const { capabilities } = useAuth();
  const contactEmail = capabilities?.privacyContactEmail || 'privacy@example.com';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 sm:p-10 space-y-6">
        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-6 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="font-display text-3xl font-semibold">TogetherSpace Privacy Policy</h1>
            <p className="text-xs text-zinc-500 mt-1">Last Updated: November 18, 2026</p>
          </div>
          <Link to="/" className="text-xs font-medium text-rose-600 hover:underline">
            Return to TogetherSpace
          </Link>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">1. Introduction</h2>
            <p>
              TogetherSpace is a private digital social platform designed strictly for two approved accounts (the
              instance owner and one invited partner or close friend). This Privacy Policy explains what data
              TogetherSpace processes, how personal Google Drive storage works, and the controls available to you.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">2. Information Collected</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Name, display name, username, bio, and email address.</li>
              <li>Authentication credentials (bcrypt password hashes) and HTTP-only session identifiers.</li>
              <li>Posts, captions, photos, videos, reels, 24-hour stories, albums, comments, likes, and saved items.</li>
              <li>Private chat messages, reactions, read status, and recorded voice notes.</li>
              <li>Google account email and encrypted OAuth tokens when you choose to connect Google Drive.</li>
              <li>Security audit logs (sign-in events, session revocations) and call metadata (call type, duration, missed status). Voice and video calls are peer-to-peer WebRTC streams and are not recorded.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">3. Google Drive Information</h2>
            <p>
              Each approved user may connect their own personal Google account via Google OAuth 2.0 with PKCE.
              TogetherSpace requests the <code className="font-mono-tabular">drive.file</code> and{' '}
              <code className="font-mono-tabular">userinfo.email</code> scopes so media you upload is stored inside a
              dedicated folder in your own Google Drive. OAuth refresh tokens are encrypted at rest and never exposed to
              the browser. Disconnecting your Google account deletes stored tokens immediately and may prevent
              TogetherSpace from streaming media stored in that Drive until reauthorized. Google processes data in your
              Drive under Google’s own Privacy Policy and Terms.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">4. How Information Is Used</h2>
            <p>
              Data is used strictly to authenticate your account, enforce the two-account limit, display your private
              feed, albums, stories, and reels, deliver real-time messages, facilitate WebRTC calls, synchronize media
              metadata, and maintain platform security and reliability.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">5. Data Sharing & Service Providers</h2>
            <p>
              TogetherSpace does not publish private posts, messages, albums, or profiles to the public, nor does it sell
              user data or run third-party advertising. Depending on your deployment configuration, data may be processed
              by infrastructure providers necessary to operate the app: Vercel (hosting/serverless compute), MongoDB
              Atlas (database persistence), Google Drive API (user-connected media storage), Ably (real-time messaging and
              signaling), a STUN/TURN relay provider (WebRTC connectivity), and Resend (transactional email delivery).
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">6. Media Privacy</h2>
            <p>
              All uploaded media is private by default. TogetherSpace does not create public Google Drive links. Every
              media stream request verifies session authentication and checks viewer authorization on the backend.
              Remember that sharing media within your TogetherSpace connection allows the second approved user to view
              that shared content.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">7. Retention and Deletion</h2>
            <p>
              Stories automatically expire from active feeds 24 hours after creation (while remaining in the creator’s
              private archive unless deleted). Removing an item or deleting your TogetherSpace account removes database
              references and OAuth tokens without silently erasing original files stored inside your personal Google
              Drive or the other user’s Google Drive. Database backups, if enabled by your hosting provider, follow
              their retention schedule.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">8. Security Controls</h2>
            <p>
              TogetherSpace implements bcrypt password hashing, HTTP-only session cookies, CSRF validation, AES-256-GCM
              encryption for OAuth refresh tokens, Zod input validation, rate limiting, and atomic two-user invitation
              consumption. No system can guarantee absolute security, and instance operators should maintain strong
              environment secrets.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">9. Your Rights and Controls</h2>
            <p>
              From Settings, you can view and edit profile information, export a JSON copy of your personal data,
              disconnect Google Drive, review and revoke active sessions, delete your posts/stories/albums/messages,
              disconnect the partner relationship, or delete your account.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">10. Children’s Privacy</h2>
            <p>
              TogetherSpace is intended for users aged 13 and older (or the applicable age of digital consent in your
              jurisdiction). Operators must review local legal requirements before deploying for public or commercial use.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">11. International Processing</h2>
            <p>
              Cloud providers (such as Vercel, MongoDB Atlas, Google, and Ably) may process and store data in regions
              outside your country depending on your configured deployment region.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">12. Policy Changes</h2>
            <p>
              Updates to this policy will be posted on this page with an updated Last Updated date and take effect upon
              publication.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">13. Contact Information</h2>
            <p>
              For privacy questions or data requests, contact the instance privacy administrator at{' '}
              <span className="font-mono-tabular font-medium">{contactEmail}</span>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
