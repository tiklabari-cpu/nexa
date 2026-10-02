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
}
