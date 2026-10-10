/**
 * What `GET /deployment` answers (tm 257.13 · ADR
 * docs/adr/pilot-public-readiness.md K-a): this deployment's own settings, the
 * same for every caller and never about a workspace. Anonymous, because the
 * panel needs it on the sign-in screen, before there is a session to ask with.
 *
 * Every field the panel reads to hide something is also enforced by the API
 * itself — this is how a screen avoids offering a door, not what locks it.
 */
export interface DeploymentConfig {
  /** `PILOT_MODE`: mock surfaces are hidden and their routes refused (403 `pilot_mode`). */
  pilot_mode: boolean;
  /** `PILOT_CONTACT_EMAIL`, or `null` when the deployment names none. */
  contact_email: string | null;
  /** `SIGNUP_ENABLED`: whether `POST /auth/signup` creates workspaces here. */
  signup_enabled: boolean;
  /**
   * `SIGNUP_EMAIL_VERIFICATION` (tm 257.7): sign-up answers 202 with no session,
   * and the new owner signs in only after `POST /auth/verify-email`.
   */
  email_verification_required: boolean;
  /** `PRIVACY_POLICY_URL` (tm 257.9), an `https` address, or `null` when none is named. */
  privacy_policy_url: string | null;
  /**
   * `TERMS_URL` (tm 257.9), or `null`. Set, `POST /auth/signup` requires
   * `terms_version` equal to the field below.
   */
  terms_url: string | null;
  /** `TERMS_VERSION`: what a sign-up sends back once the terms are accepted. */
  terms_version: string | null;
  /**
   * The Apps cards and channels this deployment connects to their real
   * provider (tm 263, `APPS_LIVE_PROVIDERS`): `brevo`, `freshdesk`, `telegram`.
   * Under `pilot_mode` these are the only ones the panel shows — the API opens
   * exactly these doors and no other. Optional for older servers: absent reads
   * as none.
   */
  live_apps?: string[];
}
