/**
 * The pilot e2e stack's addresses and deployment values (tm 257.12), shared by
 * `playwright.pilot.config.ts`, which starts the servers with them, and
 * `pilot-mode.spec.ts`, which asserts on them.
 */

/** Private ports; the browser is mapped onto them from the usual ones. */
export const PILOT_PORTS = {
  api: 4100,
  rtm: 4101,
  web: 5273,
  widget: 5274,
  smtp: 4725,
  mailbox: 4726,
} as const;

/** For calls made from Node, which Chromium's resolver rule does not cover. */
export const PILOT_API_BASE = `http://localhost:${PILOT_PORTS.api}/api/v1`;
export const PILOT_MAILBOX = `http://127.0.0.1:${PILOT_PORTS.mailbox}`;

/** Test values for the deployment's documents — linked, never fetched. */
export const PILOT_TERMS_URL = 'https://legal.siyahtus.test/terms';
export const PILOT_TERMS_VERSION = 'e2e-pilot-1';
export const PILOT_PRIVACY_URL = 'https://legal.siyahtus.test/privacy';
export const PILOT_CONTACT_EMAIL = 'pilot-contact@siyahtus.test';
