/**
 * The short-token e2e stack's addresses (tm 259.1), shared by
 * `playwright.session.config.ts`, which starts the servers with them, and
 * `session-refresh.spec.ts`, which waits on them.
 */

/** Private ports; the browser is mapped onto them from the usual ones. */
export const SESSION_PORTS = {
  api: 4200,
  rtm: 4201,
  web: 5373,
  smtp: 4825,
  mailbox: 4826,
} as const;

/**
 * This stack's `ACCESS_TOKEN_TTL`: one minute, so a test can outlive an access
 * token instead of waiting the production hour.
 */
export const SESSION_TOKEN_TTL_S = 60;

/** For calls made from Node, which Chromium's resolver rule does not cover. */
export const SESSION_API_BASE = `http://localhost:${SESSION_PORTS.api}/api/v1`;
export const SESSION_MAILBOX = `http://127.0.0.1:${SESSION_PORTS.mailbox}`;
