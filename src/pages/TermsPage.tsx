import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function TermsPage() {
  const { capabilities } = useAuth();
  const contactEmail = capabilities?.privacyContactEmail || 'privacy@example.com';

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 sm:p-10 space-y-6">
        <div className="border-b border-zinc-200 dark:border-zinc-800 pb-6 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="font-display text-3xl font-semibold">TogetherSpace Terms and Conditions</h1>
            <p className="text-xs text-zinc-500 mt-1">Last Updated: November 18, 2026</p>
          </div>
          <Link to="/" className="text-xs font-medium text-rose-600 hover:underline">
            Return to TogetherSpace
          </Link>
        </div>

        <div className="space-y-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">1. Acceptance of Terms</h2>
            <p>By accessing or using TogetherSpace, you agree to be bound by these Terms and Conditions and the Privacy Policy.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">2. Eligibility and Account Restrictions</h2>
            <p>You must meet the minimum legal age required in your jurisdiction and provide accurate account details.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">3. Two-Account Private Connection</h2>
            <p>Each TogetherSpace deployment strictly supports a maximum of two approved accounts: one owner and one invited partner.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">4. Invitation and Registration Rules</h2>
            <p>Invitations are single-use, time-limited, and may be bound to a specific email address. Sharing or circumventing invite limits is prohibited.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">5. Account Security</h2>
            <p>You are responsible for keeping your password confidential and reviewing active sessions in Settings.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">6. Acceptable Use</h2>
            <p>You must not upload unlawful, abusive, or infringing content, nor attempt unauthorized access to the other user’s account or personal Google Drive.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">7. User Content Ownership</h2>
            <p>You retain full ownership of all photos, videos, audio notes, captions, and albums you upload. TogetherSpace claims no ownership over user media.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">8. Permission to Store and Display Content</h2>
            <p>You grant TogetherSpace only the limited technical permission required to store metadata, upload to your connected storage, and stream your shared content to your approved partner.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">9. Google Drive Integration</h2>
            <p>Google Drive storage relies on your personal Google account quota and authorization, which you may revoke at any time.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">10. Third-Party Services</h2>
            <p>Google, Vercel, MongoDB Atlas, Ably, TURN relay providers, and Resend operate under their own independent terms and privacy policies.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">11. Private Messaging and Calls</h2>
            <p>Private messages and WebRTC calls are restricted to the two approved accounts. Calls are not recorded by default.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">12. Content Deletion and Account Termination</h2>
            <p>You may delete content or terminate your account at any time. Terminating your account does not automatically erase files stored in the other user’s Google Drive.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">13. Service Availability</h2>
            <p>TogetherSpace is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis without uninterrupted uptime guarantees.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">14. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, operators are not liable for indirect, incidental, or consequential damages arising from service use or third-party outages.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">15. Changes to Terms</h2>
            <p>These Terms may be updated periodically; continued use after updates constitutes acceptance.</p>
          </section>
          <section className="space-y-1.5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">16. Contact Information</h2>
            <p>
              Questions about these Terms may be directed to{' '}
              <span className="font-mono-tabular font-medium">{contactEmail}</span>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
