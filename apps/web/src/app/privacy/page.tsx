import type { Metadata } from 'next';
import { MarketingShell } from '@/components/customer/MarketingShell';
import styles from '@/components/customer/marketing.module.css';

export const metadata: Metadata = {
  title: 'Privacy policy | The GM Method',
  description: 'How the GM Method fitness app handles account, health, coaching, and payment data.',
};

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <article>
        <header className={styles.legalHero}>
          <p className={styles.eyebrow}>LAST UPDATED · 19 JULY 2026</p>
          <h1>Privacy, in plain language.</h1>
          <p>
            Fitness data is personal. This policy explains what the GM Method uses, why it is
            needed, and the controls available to you.
          </p>
        </header>
        <div className={styles.prose}>
          <h2>Information you provide</h2>
          <p>
            We process account details, onboarding answers, workout and nutrition logs, body
            measurements, progress photos, support messages, coaching interactions, delivery
            addresses, and meal-order details when you choose to use those features.
          </p>

          <h2>How information is used</h2>
          <p>
            We use this information to operate your account, calculate targets and trends, sync
            your activity, provide coaching, fulfil meal orders, prevent abuse, answer support
            requests, and maintain the safety and reliability of the service. We do not sell
            health or workout data.
          </p>

          <h2>Local and cloud storage</h2>
          <p>
            The mobile app stores logs locally so core tracking continues without a connection.
            Account and synced service data is stored in our hosted PostgreSQL database. Images
            and receipts may be stored with our image-delivery provider and are accessed through
            controlled URLs. Store subscription status may be processed by Apple, Google, and
            RevenueCat; their own privacy terms also apply.
          </p>

          <h2>Coaches, buddies, and meal partners</h2>
          <p>
            Assigned coaches see only the member information needed for the coaching features
            available to them. Buddy features do not expose weight, photos, or nutrition unless a
            sharing control says otherwise. Meal partners receive the order and delivery details
            required to fulfil an order, not your private fitness history.
          </p>

          <h2>Your controls</h2>
          <ul>
            <li>Update profile and privacy preferences in Settings.</li>
            <li>Remove individual logs or photos where the feature provides deletion.</li>
            <li>Export recent health and training logs from Settings.</li>
            <li>Use Support to request a broader account-data copy.</li>
            <li>Use Delete account in Settings to begin account deletion.</li>
            <li>Sign out of all active sessions from the security settings.</li>
          </ul>

          <h2>Retention and deletion</h2>
          <p>
            Data is kept only for as long as needed to provide the service, meet legal and payment
            record obligations, resolve disputes, prevent fraud, and protect users. When an
            account is deleted, personal data is deleted or anonymized as appropriate; limited
            transaction and audit records may be retained when the law or financial reconciliation
            requires it.
          </p>

          <h2>Security</h2>
          <p>
            We use scoped access controls, validated API payloads, session controls, and protected
            credential storage. No system is risk-free. If you believe your account is at risk,
            sign out all sessions and contact support through the app.
          </p>

          <h2>Questions</h2>
          <p>
            Open <strong>Support</strong> in the app for privacy questions or requests. Staff,
            coaches, and meal partners can use the support channel in their signed-in portal.
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
