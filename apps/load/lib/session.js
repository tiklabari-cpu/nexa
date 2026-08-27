/**
 * Signing in, the way the panel does it.
 *
 * OAuth 2.1 authorization code + PKCE `S256` (NFR-S1), three calls:
 * `/auth/login` to discover which workspace the account belongs to,
 * `/auth/authorize` to get a code, `/auth/token` to exchange it. Not a
 * database insert and not a hand-minted JWT — a token this suite did not get
 * through the real doors would let the load run pass while the doors are shut.
 *
 * Called from `setup()`, ONCE per run, and the resulting token is handed to
 * every VU. That is not an optimisation: `/auth/login` and `/auth/authorize`
 * are anonymous endpoints capped at 30/min per IP (ADR-07), so a per-VU sign-in
 * spends the whole run's quota during ramp-up and the scenario then measures
 * 429s. `apps/e2e/tests/fixtures.ts` hit exactly this and moved the same work
 * to a worker-scoped fixture for the same reason.
 */
import { fail } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { CONFIG } from './config.js';
import { postJson as post } from './http.js';
import { OP_TAGS } from './thresholds.js';

/** A fresh PKCE pair. 32 random bytes → 43 base64url chars, inside the 43–128 the spec allows. */
function pkce() {
  const verifier = encoding.b64encode(crypto.randomBytes(32), 'rawurl');
  return { verifier, challenge: crypto.sha256(verifier, 'base64rawurl') };
}

/** POST JSON, tagged `setup` so three auth round trips stay out of the latency budgets. */
function postJson(path, body) {
  return post(`${CONFIG.apiBaseUrl}${path}`, body, OP_TAGS.setup);
}

/** Abort the run with the status and body, rather than a bare assertion. */
function refuse(step, response) {
  fail(`${step} failed: ${response.status} ${String(response.body).slice(0, 300)}`);
}

/**
 * @returns {{ accessToken: string, organizationId: string, licenseId: string, scope: string }}
 */
export function signIn() {
  const login = postJson('/auth/login', { email: CONFIG.email, password: CONFIG.password });
  if (login.status !== 200) refuse('login', login);

  const memberships = login.json('memberships') ?? [];
  const tenant = memberships.find((m) => String(m.organization_name).startsWith(CONFIG.orgPrefix));
  if (!tenant) {
    fail(
      `no seeded workspace whose name starts with ${JSON.stringify(CONFIG.orgPrefix)} — ` +
        `run \`pnpm db:seed\` first (saw: ${memberships.map((m) => m.organization_name).join(', ') || 'none'})`,
    );
  }

  const { verifier, challenge } = pkce();
  const authorized = postJson('/auth/authorize', {
    client_id: tenant.client_id,
    redirect_uri: CONFIG.redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    email: CONFIG.email,
    password: CONFIG.password,
    license_id: tenant.license_id,
  });
  if (authorized.status !== 200) refuse('authorize', authorized);

  const granted = postJson('/auth/token', {
    grant_type: 'authorization_code',
    code: authorized.json('code'),
    code_verifier: verifier,
    client_id: tenant.client_id,
    redirect_uri: CONFIG.redirectUri,
  });
  if (granted.status !== 200) refuse('token', granted);

  return {
    accessToken: granted.json('access_token'),
    organizationId: tenant.organization_id,
    licenseId: String(tenant.license_id),
    scope: granted.json('scope'),
  };
}

/** Request headers for an authenticated call. */
export function authHeaders(session) {
  return { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' };
}
