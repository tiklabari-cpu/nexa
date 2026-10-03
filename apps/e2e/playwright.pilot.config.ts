import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
import {
  PILOT_API_BASE,
  PILOT_CONTACT_EMAIL,
  PILOT_MAILBOX,
  PILOT_PORTS as PORTS,
  PILOT_PRIVACY_URL,
  PILOT_TERMS_URL,
  PILOT_TERMS_VERSION,
} from './tests/pilot-stack.js';

/**
 * The public pilot in a real browser (tm 257.12): `tests/pilot-mode.spec.ts`
 * against an API started with `PILOT_MODE=true`.
 *
 *     pnpm test:e2e:pilot
 *
 * The main suite cannot measure this. Locally it adopts whatever dev servers
 * already hold its ports (`reuseExistingServer`), and an adopted server never
 * receives the config's `env` — so the flag would be whatever the root `.env`
 * says, which is off and must stay off. And the main suite drives exactly the
 * surfaces the pilot refuses (billing purchases, fake channels, sample data).
 *
 * So this is a stack of its own, beside any dev stack rather than instead of it:
 *
 *   - every server is started here (`reuseExistingServer: false`) on a private
 *     port — api 4100, rtm 4101, web 5273, widget 5274, mail 4725/4726;
 *   - the browser still sees the usual origins. Chromium's resolver maps
 *     `localhost:4000/4001/5173/5174` (and the widget's host page) onto the
 *     private ports, so the page origin stays `http://localhost:5173` — the one
 *     OAuth redirect every workspace registers — and the API's CORS allowlist
 *     and mail links need no change. Calls made from Node (the spec's own
 *     requests) do not see that rule and use the private ports directly;
 *   - the database and Redis index are private too. The script wraps the run in
 *     `apps/api/scripts/with-test-datastores.ts`, and the inherited global setup
 *     resets and seeds whatever `DATABASE_URL` says — which is why this file
 *     refuses to start against anything but one of that script's databases.
 */

const database = process.env['DATABASE_URL'] ?? '';
if (!/\/siyahtus_test_[0-9a-f]{12}(\?|$)/.test(database)) {
  throw new Error(
    'playwright.pilot.config.ts resets and seeds DATABASE_URL, so it only runs against a private ' +
      'test database. Start it with `pnpm test:e2e:pilot`, which provides one.',
  );
}

const baseServers = Array.isArray(base.webServer) ? base.webServer : [];
const baseApi = baseServers.find((server) => server.command.includes('@siyahtus/api dev'));
if (!baseApi?.env) throw new Error('playwright.config.ts no longer starts the api with an env.');

/** Vite's dependency cache for this stack's two dev servers, apart from the usual one. */
const VITE_CACHE_DIR = 'node_modules/.vite-e2e-pilot';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: 'pilot-mode.spec.ts',
  outputDir: './test-results/pilot',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report/pilot' }]],
  projects: [
    {
      name: 'chromium-pilot',
      use: {
        ...(base.projects?.[0]?.use ?? {}),
        launchOptions: {
          args: [
            '--host-resolver-rules=' +
              [
                `MAP localhost:4000 localhost:${PORTS.api}`,
                `MAP localhost:4001 localhost:${PORTS.rtm}`,
                `MAP localhost:5173 localhost:${PORTS.web}`,
                `MAP localhost:5174 localhost:${PORTS.widget}`,
                `MAP *.localhost:5174 localhost:${PORTS.widget}`,
              ].join(', '),
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @siyahtus/api mock-smtp',
      url: `${PILOT_MAILBOX}/health`,
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
      url: `${PILOT_API_BASE}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
      // The main suite's api env (mock AI, raised limits, no sweeps, mail over
      // SMTP to the stand-in), then the pilot on top of it. Not production, so
      // the production-only rules (a real model, a real carrier) do not apply.
      env: {
        ...baseApi.env,
        API_PORT: String(PORTS.api),
        SMTP_PORT: String(PORTS.smtp),
        PILOT_MODE: 'true',
        PILOT_CONTACT_EMAIL,
        SIGNUP_ENABLED: 'true',
        SIGNUP_EMAIL_VERIFICATION: 'true',
        TERMS_URL: PILOT_TERMS_URL,
        TERMS_VERSION: PILOT_TERMS_VERSION,
        PRIVACY_POLICY_URL: PILOT_PRIVACY_URL,
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
    {
      command: 'pnpm --filter @siyahtus/widget dev --strictPort',
      url: `http://localhost:${PORTS.widget}/demo.html`,
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
      env: {
        ...process.env,
        WIDGET_PORT: String(PORTS.widget),
        SIYAHTUS_VITE_CACHE_DIR: VITE_CACHE_DIR,
      },
    },
  ],
});
