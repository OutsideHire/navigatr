/**
 * /privacy — Privacy Policy (Navigatr LLC).
 *
 * Finalized policy: discloses navigatr's Google Calendar access + the
 * Google API Services "Limited Use" commitments, plus CCPA/CPRA and
 * GDPR/UK rights. Public route (no auth) so it can back the Google OAuth
 * verification submission and vendor/security review. `draft={false}` —
 * no DRAFT banner. Counsel review of the copy is still advisable; two
 * values (the "Last updated" date and the children's-age threshold) are
 * product/legal choices, not code-derived.
 */
import { LegalPageShell } from "../components/LegalPageShell";

const CONTACT = "privacy@getnavigatr.io";

export function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy Policy" lastUpdated="July 8, 2026" draft={false}>
      <p>
        This Privacy Policy explains how <strong>Navigatr&nbsp;LLC</strong>{" "}
        (&ldquo;navigatr&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects,
        uses, stores, and shares information when you use the navigatr
        application at{" "}
        <a href="https://app.getnavigatr.io">app.getnavigatr.io</a> and related
        sites (the &ldquo;Service&rdquo;).
      </p>

      <section>
        <h2>1. Who we are</h2>
        <p>
          navigatr is a field-sales productivity tool that helps sales
          representatives plan routes, manage deals, and keep their schedule
          organized. Contact: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </section>

      <section>
        <h2>2. Information we collect</h2>
        <ul>
          <li>
            <strong>Account information</strong> you provide (name, email,
            organization).
          </li>
          <li>
            <strong>Sales data</strong> you enter into navigatr (deals,
            contacts, activities, paths).
          </li>
          <li>
            <strong>Google account data</strong>, only if you choose to connect
            your Google Calendar &mdash; described in Section 3.
          </li>
          <li>
            <strong>Usage and device data</strong> (log data, IP address,
            browser type) collected automatically to operate and secure the
            Service.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Google Calendar data &mdash; what we access and why</h2>
        <p>
          If you connect your Google Calendar, you grant navigatr the access
          below. We request the minimum scopes needed for the features
          described.
        </p>
        <ul>
          <li>
            <strong>Calendar list (read-only)</strong> &mdash; to identify your{" "}
            <strong>primary</strong> calendar so we read from and write to the
            correct calendar.
          </li>
          <li>
            <strong>Calendar events (read + write)</strong> &mdash; to read your
            day&rsquo;s events so we can plan sales routes around your meetings,
            and to create, update, or delete the appointments, follow-up
            reminders, and prospecting day-blocks{" "}
            <strong>you create inside navigatr</strong>.
          </li>
        </ul>
        <p>How we use Google Calendar data &mdash; specifically and only:</p>
        <ul>
          <li>
            To <strong>display</strong> your existing meetings alongside your
            planned route, and to automatically schedule prospect visits around
            those meetings (respecting travel time).
          </li>
          <li>
            To <strong>write</strong> events on your primary calendar when you
            book an appointment, set a follow-up, or plan a prospecting day
            inside navigatr, so your schedule stays in one place.
          </li>
        </ul>
        <p>What we do NOT do:</p>
        <ul>
          <li>
            We do <strong>not</strong> store the content of your meetings.
            Events read to build your route are used transiently and are not
            saved to our database.
          </li>
          <li>
            We do <strong>not</strong> modify or delete events that navigatr did
            not create. Every event we create is tagged, and we only ever change
            events carrying that tag.
          </li>
          <li>
            We do <strong>not</strong> use Google Calendar data for advertising,
            and we do <strong>not</strong> sell it.
          </li>
          <li>
            We do <strong>not</strong> use Google Calendar data to develop,
            improve, or train generalized or non-personalized
            artificial-intelligence or machine-learning models.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. How we store and protect Google data</h2>
        <ul>
          <li>
            <strong>OAuth tokens</strong> (which let navigatr access your
            calendar) are stored <strong>encrypted at rest</strong> in a
            dedicated secrets vault, accessible only to privileged server
            processes.
          </li>
          <li>
            <strong>The only calendar data we retain</strong> is the identifier
            and sync status of events navigatr itself created on your calendar
            &mdash; so we can keep them in sync. We do not retain your other
            events&rsquo; details.
          </li>
          <li>
            Data is hosted with our infrastructure provider Supabase
            (us-west-1) and transmitted over encrypted connections (TLS).
          </li>
        </ul>
      </section>

      <section>
        <h2>5. How we share information</h2>
        <p>
          We do not sell your personal information or Google user data. We share
          data only with:
        </p>
        <ul>
          <li>
            <strong>Service providers (&ldquo;subprocessors&rdquo;)</strong>{" "}
            that operate the Service on our behalf (e.g., our cloud hosting and
            database provider), under contractual confidentiality and
            data-protection obligations.
          </li>
          <li>
            <strong>Google</strong>, as necessary to provide the calendar
            features you enabled.
          </li>
          <li>
            <strong>Legal / safety</strong> recipients when required by law or
            to protect rights and safety.
          </li>
          <li>
            A <strong>successor entity</strong> in a merger or acquisition, with
            notice to you as required by law.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Limited Use disclosure (Google API Services User Data Policy)</h2>
        <p>
          navigatr&rsquo;s use and transfer to any other app of information
          received from Google APIs will adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the <strong>Limited Use</strong> requirements.
          Specifically:
        </p>
        <ul>
          <li>
            We only use Google user data to provide and improve the user-facing
            features described in this policy.
          </li>
          <li>
            We only transfer Google user data if necessary to provide or improve
            those features, to comply with applicable law, or as part of a
            merger or acquisition.
          </li>
          <li>We do not use Google user data for serving advertisements.</li>
          <li>
            We do not allow humans to read Google user data unless: (a) you have
            given specific consent to access specific data; (b) it is necessary
            for security purposes; (c) it is necessary to comply with applicable
            law; or (d) the data has been aggregated and anonymized for internal
            operations.
          </li>
          <li>
            We do not use Google user data to develop, improve, or train
            generalized or non-personalized AI/ML models.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Data retention and deletion</h2>
        <ul>
          <li>
            You can disconnect Google Calendar at any time from navigatr&rsquo;s{" "}
            <strong>Settings &rarr; Integrations</strong>. On disconnect, we
            revoke and delete the stored OAuth tokens.
          </li>
          <li>
            You can also revoke navigatr&rsquo;s access directly at{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Account permissions
            </a>
            .
          </li>
          <li>
            To request deletion of your navigatr account and associated data,
            contact <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We delete or
            anonymize your data within 30 days, except where retention is
            required by law.
          </li>
        </ul>
      </section>

      <section>
        <h2>8. Your choices and privacy rights</h2>
        <ul>
          <li>
            Connecting Google Calendar is optional; navigatr&rsquo;s other
            features work without it.
          </li>
          <li>
            You may access, correct, or delete your data as described above or
            by contacting us.
          </li>
        </ul>

        <h2>8a. California residents (CCPA/CPRA)</h2>
        <p>If you are a California resident, you have the right to:</p>
        <ul>
          <li>
            <strong>Know</strong> what personal information we collect, use, and
            disclose, and to request a copy.
          </li>
          <li>
            <strong>Delete</strong> the personal information we hold about you,
            subject to legal exceptions.
          </li>
          <li>
            <strong>Correct</strong> inaccurate personal information.
          </li>
          <li>
            <strong>Opt out of the sale or sharing</strong> of personal
            information. <strong>We do not sell or share</strong> your personal
            information (including Google user data) as those terms are defined
            under the CCPA/CPRA.
          </li>
          <li>
            <strong>Limit the use of sensitive personal information</strong> to
            what is necessary to provide the Service.
          </li>
          <li>
            <strong>Non-discrimination</strong> &mdash; we will not discriminate
            against you for exercising these rights.
          </li>
        </ul>
        <p>
          To exercise these rights, contact{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We will verify your
          identity before responding; authorized agents may submit requests with
          proof of authorization.
        </p>

        <h2>8b. EEA, UK, and Switzerland residents (GDPR / UK GDPR)</h2>
        <p>
          If you are in the EEA, UK, or Switzerland, the data controller is
          Navigatr LLC, 3141 Spyglass Hill Rd., Edmond, OK 73034. Our legal
          bases for processing are:
        </p>
        <ul>
          <li>
            <strong>Consent</strong> &mdash; for connecting your Google Calendar
            (you may withdraw consent at any time by disconnecting).
          </li>
          <li>
            <strong>Performance of a contract</strong> &mdash; to provide the
            Service you signed up for.
          </li>
          <li>
            <strong>Legitimate interests</strong> &mdash; to secure, maintain,
            and improve the Service.
          </li>
          <li>
            <strong>Legal obligation</strong> &mdash; where processing is
            required by law.
          </li>
        </ul>
        <p>
          You have the right to{" "}
          <strong>access, rectify, erase, restrict, or port</strong> your data,
          to <strong>object</strong> to processing, and to{" "}
          <strong>withdraw consent</strong>. You may also{" "}
          <strong>lodge a complaint</strong> with your local supervisory
          authority. Where we transfer data outside the EEA/UK, we rely on
          appropriate safeguards such as Standard Contractual Clauses. Contact{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a> to exercise these rights.
        </p>
      </section>

      <section>
        <h2>9. Children&rsquo;s privacy</h2>
        <p>
          The Service is not directed to children under 16 and we do not
          knowingly collect their data.
        </p>
      </section>

      <section>
        <h2>10. Changes to this policy</h2>
        <p>
          We may update this policy; we will post the new version here and
          update the &ldquo;Last updated&rdquo; date. Material changes will be
          communicated as required by law.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Navigatr LLC &mdash; 3141 Spyglass Hill Rd., Edmond, OK 73034 &mdash;{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </section>
    </LegalPageShell>
  );
}

export default PrivacyPage;
