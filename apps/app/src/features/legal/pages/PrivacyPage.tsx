/**
 * /privacy — Privacy Policy.
 *
 * Same shape as TermsPage. DRAFT placeholder copy. The URL is live so
 * that vendor security questionnaires + contract review can link it.
 * Replace with lawyer-reviewed copy before the first paying ISO.
 */
import { LegalPageShell } from "../components/LegalPageShell";

export function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      lastUpdated="May 29, 2026 (DRAFT)"
    >
      <section>
        <h2>1. Information We Collect</h2>
        <p>We collect information you provide directly:</p>
        <ul>
          <li>Account info: name, email, password (hashed)</li>
          <li>Profile info: role, organization, profession</li>
          <li>Activity data: deals you create, contacts you enter, notes you log</li>
          <li>Communications: emails you send through integrated mailboxes</li>
        </ul>
        <p>We also collect automatically:</p>
        <ul>
          <li>Device + browser identifiers</li>
          <li>Usage data: pages viewed, actions taken, timestamps</li>
          <li>Error reports (with PII redacted at the client)</li>
          <li>IP address + approximate location</li>
        </ul>
      </section>

      <section>
        <h2>2. How We Use Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide, maintain, and improve the Service</li>
          <li>Process transactions and send related notifications</li>
          <li>Send service announcements + product updates (you can opt out)</li>
          <li>Respond to your comments + questions</li>
          <li>Monitor and analyze trends to improve user experience</li>
          <li>Detect and prevent fraud + security incidents</li>
        </ul>
      </section>

      <section>
        <h2>3. How We Share Information</h2>
        <p>We share information only as needed:</p>
        <ul>
          <li>
            <strong>With other users in your organization:</strong> profile
            info + activity records are visible per the role hierarchy
            configured by your admin
          </li>
          <li>
            <strong>With service providers:</strong> hosting (Supabase,
            Vercel), error tracking (Sentry), email delivery (Resend),
            payment processing (Stripe when applicable)
          </li>
          <li>
            <strong>For legal reasons:</strong> when required by law or to
            protect rights, property, or safety
          </li>
          <li>
            <strong>In connection with a business transfer:</strong> e.g.,
            merger or acquisition, with notice to affected users
          </li>
        </ul>
        <p>
          We do NOT sell your personal information.
        </p>
      </section>

      <section>
        <h2>4. Data Retention</h2>
        <p>
          We retain account information while your account is active.
          Activity data is retained per your organization&apos;s contracted
          retention window. You can request deletion of your account at any
          time (see Section 7).
        </p>
      </section>

      <section>
        <h2>5. Security</h2>
        <p>
          We employ industry-standard security measures including TLS
          encryption in transit, encrypted storage at rest, row-level
          security on all customer data, and OAuth-scoped third-party
          integrations. No system is perfectly secure; we encourage you to
          use a strong unique password and enable two-factor authentication
          when available.
        </p>
      </section>

      <section>
        <h2>6. Your Rights</h2>
        <p>
          Depending on your jurisdiction (including GDPR and CCPA), you may
          have the right to:
        </p>
        <ul>
          <li>Access the personal information we hold about you</li>
          <li>Correct inaccuracies</li>
          <li>Delete your personal information</li>
          <li>Export your data in a portable format</li>
          <li>Opt out of certain processing</li>
        </ul>
        <p>
          To exercise these rights, email{" "}
          <a href="mailto:privacy@outsidehire.com">privacy@outsidehire.com</a>.
        </p>
      </section>

      <section>
        <h2>7. Cookies + Similar Technology</h2>
        <p>
          We use essential cookies to provide the Service (authentication
          tokens, session state). With your consent, we also use analytics
          cookies to understand how the Service is used. You can manage
          consent via the cookie banner shown on first visit.
        </p>
      </section>

      <section>
        <h2>8. Children</h2>
        <p>
          The Service is not intended for users under 18. We do not
          knowingly collect information from children.
        </p>
      </section>

      <section>
        <h2>9. Changes to this Policy</h2>
        <p>
          We may update this Policy from time to time. We will notify you of
          material changes by email or in-product notification before they
          take effect.
        </p>
      </section>

      <section>
        <h2>10. Contact</h2>
        <p>
          Questions about this Policy? Email{" "}
          <a href="mailto:privacy@outsidehire.com">privacy@outsidehire.com</a>.
        </p>
      </section>
    </LegalPageShell>
  );
}

export default PrivacyPage;
