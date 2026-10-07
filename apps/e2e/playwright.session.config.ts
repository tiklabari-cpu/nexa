import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
import {
  SESSION_API_BASE,
  SESSION_MAILBOX,
  SESSION_PORTS as PORTS,
  SESSION_TOKEN_TTL_S,
} from './tests/session-stack.js';

/**
 * An open panel outliving its access token (tm 259.1):
 * `tests/session-refresh.spec.ts` against an API started with
 * `ACCESS_TOKEN_TTL=60`.
 *
 *     pnpm test:e2e:session
 *
 * The main suite cannot measure this. Its tokens live the production hour, and
 * locally it adopts whatever dev servers already hold its ports
 * (`reuseExistingServer`) — an adopted server never receives a config's `env`,
 * so the setting would not reach it anyway. Shortening the hour for the whole
 * suite would put every spec through renewals it is not about.
 *
 * So this is a stack of its own, built exactly like the pilot's
 * (`playwright.pilot.config.ts` explains each part): every server started here
 * on a private port — api 4200, rtm 4201, web 5373, mail 4825/4826 — with
 * Chromium's resolver mapping the usual origins onto them, so the page still
 * runs on `http://localhost:5173`; and a private database and Redis index from
 * `apps/api/scripts/with-test-datastores.ts`, which the inherited global setup
 * resets and seeds. No widget server: nothing here opens the widget.
 */

const database = process.env['DATABASE_URL'] ?? '';
if (!/\/siyahtus_test_[0-9a-f]{12}(\?|$)/.test(database)) {
  throw new Error(
    'playwright.session.config.ts resets and seeds DATABASE_URL, so it only runs against a ' +
      'private test database. Start it with `pnpm test:e2e:session`, which provides one.',
  );
}

const baseServers = Array.isArray(base.webServer) ? base.webServer : [];
const baseApi = baseServers.find((server) => server.command.includes('@siyahtus/api dev'));
if (!baseApi?.env) throw new Error('playwright.config.ts no longer starts the api with an env.');

/** Vite's dependency cache for this stack's dev server, apart from the usual one. */
const VITE_CACHE_DIR = 'node_modules/.vite-e2e-session';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: 'session-refresh.spec.ts',
  outputDir: './test-results/session',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report/session' }]],
  projects: [
    {
      name: 'chromium-session',
      use: {
        ...(base.projects?.[0]?.use ?? {}),
        launchOptions: {
          args: [
            '--host-resolver-rules=' +
              [
                `MAP localhost:4000 localhost:${PORTS.api}`,
                `MAP localhost:4001 localhost:${PORTS.rtm}`,
                `MAP localhost:5173 localhost:${PORTS.web}`,
              ].join(', '),
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @siyahtus/api mock-smtp',
      url: `${SESSION_MAILBOX}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
      env: {
        ...process.env,
        MOCK_SMTP_PORT: String(PORTS.smtp),
        MOCK_SMTP_HTTP_PORT: String(PORTS.mailbox),
      },
    },
    {
      command: 'pnpm --filter @siyahtus/api dev',
      url: `${SESSION_API_BASE}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
      // The main suite's api env (mock AI, raised limits, no sweeps, mail to
      // the stand-in), with the token's life cut to a minute — the one setting
      // this stack exists for — and the pilot flag pinned off.
      env: {
        ...baseApi.env,
        API_PORT: String(PORTS.api),
        SMTP_PORT: String(PORTS.smtp),
        ACCESS_TOKEN_TTL: String(SESSION_TOKEN_TTL_S),
        PILOT_MODE: 'false',
      },
    },
    {
      command: 'pnpm --filter @siyahtus/rtm dev',
      url: `http://localhost:${PORTS.rtm}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
      env: { ...process.env, RTM_PORT: String(PORTS.rtm) },
    },
    {
      // The panel calls the relative `/api/v1` through Vite's proxy, which runs
      // in Node and so would reach the usual api on 4000 without this.
      command: 'pnpm --filter @siyahtus/web dev --strictPort',
      url: `http://localhost:${PORTS.web}`,
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
      env: {
        ...process.env,
        WEB_PORT: String(PORTS.web),
        API_BASE_URL: `http://localhost:${PORTS.api}`,
        SIYAHTUS_VITE_CACHE_DIR: VITE_CACHE_DIR,
      },
    },
  ],
});
