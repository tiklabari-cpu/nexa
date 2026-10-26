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

/** How loud the root panel's announcement is (FR-ADMIN-15 · tm 389.13). */
export const ANNOUNCEMENT_LEVELS = ['info', 'warning', 'critical'] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

/**
 * `full` refuses every request but health, the notice and signing out;
 * `read_only` refuses writes and lets everything be read.
 */
export const MAINTENANCE_MODES = ['read_only', 'full'] as const;
export type MaintenanceMode = (typeof MAINTENANCE_MODES)[number];

/** One sentence in both languages the panel ships — the operator writes both. */
export interface LocalizedNoticeText {
  en: string;
  tr: string;
}

/**
 * The deployment-wide announcement an operator set in the root panel
 * (`platform_settings.announcement`). `until` passed, it is not shown.
 */
export interface DeploymentAnnouncement extends LocalizedNoticeText {
  level: AnnouncementLevel;
  /** ISO-8601; `null` keeps it up until the operator takes it down. */
  until: string | null;
}

/** Maintenance mode as the panel reads it — present only while it is on. */
export interface DeploymentMaintenance {
  mode: MaintenanceMode;
  /** The operator's words for the banner or the full page; `null` uses the panel's own. */
  message: LocalizedNoticeText | null;
}

/**
 * What `GET /deployment/notice` answers (tm 389.13): its own route rather
 * than two more `DeploymentConfig` fields, so the sign-in screen's settings
 * keep their shape. Anonymous like `/deployment`, and readable in maintenance.
 */
export interface DeploymentNotice {
  announcement: DeploymentAnnouncement | null;
  maintenance: DeploymentMaintenance | null;
}
