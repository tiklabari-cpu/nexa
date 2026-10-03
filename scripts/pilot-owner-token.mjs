#!/usr/bin/env node
/**
 * An owner's access token for a pilot stack, for `scripts/smoke.sh`'s
 * SMOKE_ADMIN_TOKEN (tm 257.12).
 *
 * The pilot has no seed and no personal access token, and `POST /auth/signup`
 * answers without one, so the only way to an owner's token is the panel's own
 * sign-in: login → authorize (OAuth 2.1 + PKCE, S256) → token, with the
 * redirect every workspace registers — the panel's origin + `/auth/callback`
 * (the e2e `ownerAccessTokenFor` helper, `apps/e2e/tests/fixtures.ts`, does the
 * same against the dev stack).
 *
 *     PILOT_OWNER_EMAIL=… PILOT_OWNER_PASSWORD=… \
 *       node scripts/pilot-owner-token.mjs --api=http://localhost:14000 --web=http://localhost:15173
 *
 *     SMOKE_ADMIN_TOKEN="$(node scripts/pilot-owner-token.mjs …)"
 *     SMOKE_ORGANIZATION_ID="$(node scripts/pilot-owner-token.mjs … --organization-id)"
 *
 * Base URLs: `--api` / `PILOT_API_BASE` (default http://localhost:4000) and
 * `--web` / `PILOT_WEB_BASE` (default http://localhost:5173) — the panel's
 * address as the api's WEB_APP_URL names it, or the redirect is refused. The
 * credentials come from the environment only, never from an argument (a
 * command line is visible to every process on the host). The token goes to
 * stdout and nowhere else — no file — and expires like any panel session.
 * `--organization-id` prints the workspace's organization id instead; with
 * more than one workspace, `--organization=<name prefix>` picks one.
 *
 * With SIGNUP_EMAIL_VERIFICATION=true a new owner cannot sign in before the
 * address is confirmed. A rehearsal whose mail goes nowhere (an `.invalid`
 * SMTP_HOST) confirms it in the database instead, from the stack's own db
 * container — Git Bash needs MSYS_NO_PATHCONV=1, and the address goes where
 * the placeholder is:
 *
 *     MSYS_NO_PATHCONV=1 docker exec -i <project>-db-1 psql -U siyahtus -d siyahtus \
 *       -c "UPDATE accounts SET email_verified_at = now() WHERE email = '<owner address>'"
 *
 * A real pilot owner opens the mailed link instead; nothing here is for that.
 */
import { createHash, randomBytes } from 'node:crypto';

function option(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

/**
 * Stops the run with a message. Thrown rather than `process.exit`: exiting
 * while fetch's sockets are still closing trips a libuv assertion on Windows
 * (exit 127 instead of the intended code).
 */
class Failure extends Error {}
function fail(message) {
  throw new Failure(message);
}

async function main() {
  const apiBase = `${(option('api') ?? process.env.PILOT_API_BASE ?? 'http://localhost:4000').replace(/\/+$/, '')}/api/v1`;
  const webBase = (option('web') ?? process.env.PILOT_WEB_BASE ?? 'http://localhost:5173').replace(
    /\/+$/,
    '',
  );
  const email = process.env.PILOT_OWNER_EMAIL;
  const password = process.env.PILOT_OWNER_PASSWORD;
  if (!email || !password) fail('set PILOT_OWNER_EMAIL and PILOT_OWNER_PASSWORD.');

  async function post(path, body) {
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      fail(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    // The status and the error's type only: a body could echo what was sent.
    if (!response.ok) {
      let type = '';
      try {
        type = JSON.parse(text)?.error?.type ?? '';
      } catch {
        // not JSON
      }
      fail(`${path} answered ${response.status}${type ? ` ${type}` : ''}.`);
    }
    return JSON.parse(text);
  }

  const { memberships } = await post('/auth/login', { email, password });
  const prefix = option('organization');
  const candidates = (memberships ?? []).filter(
    (m) => prefix === undefined || m.organization_name.startsWith(prefix),
  );
  if (candidates.length !== 1) {
    fail(
      candidates.length === 0
        ? 'no workspace matches this account.'
        : `${candidates.length} workspaces match; pick one with --organization=<name prefix>.`,
    );
  }
  const [membership] = candidates;

  if (process.argv.includes('--organization-id')) {
    process.stdout.write(`${membership.organization_id}\n`);
    return;
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = `${webBase}/auth/callback`;

  const { code } = await post('/auth/authorize', {
    client_id: membership.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    email,
    password,
    license_id: membership.license_id,
  });
  const { access_token: accessToken } = await post('/auth/token', {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: membership.client_id,
    redirect_uri: redirectUri,
  });
  process.stdout.write(`${accessToken}\n`);
}

try {
  await main();
} catch (error) {
  if (!(error instanceof Failure)) throw error;
  process.stderr.write(`pilot-owner-token: ${error.message}\n`);
  process.exitCode = 1;
}
