/**
 * Operator-signed identity for a test (ID-03 · K28 · tm 388): turn the feature
 * on for a workspace and sign identities the way the operator's server does.
 *
 * `enableSignedIdentity` takes the production path — the switch through
 * `PATCH /settings/member-recognition`, the secret through
 * `POST /settings/member-recognition/identity-secret` — with an owner token,
 * and hands back the secret that one response carries. `signedIdentity`
 * builds what the page hands `siyahtus('identify', …)`, signed with
 * `signIdentity` at the database's clock (the clock the mint checks against).
 */
import type { PrismaClient } from '@prisma/client';
import { expect } from 'vitest';
import { signIdentity } from '../../src/services/auth/member-identity.js';
import { grantToken, type TenantFixture } from './fixtures.js';
import type { TestServer } from './server.js';

export interface SignedIdentityPayload {
  user_id: string;
  username?: string;
  email?: string;
  ts: number;
  user_hash: string;
}

/** An owner's token on the workspace's Security settings. */
export async function securityAdmin(owner: PrismaClient, tenant: TenantFixture): Promise<string> {
  return grantToken(owner, {
    licenseId: tenant.licenseId,
    organizationId: tenant.organizationId,
    ownerId: tenant.ownerAccountId,
    scopes: ['access_rules:rw', 'customers:rw'],
  });
}

/** Switch signed identity on and issue its first secret; the secret, as the admin sees it once. */
export async function enableSignedIdentity(
  server: TestServer,
  owner: PrismaClient,
  tenant: TenantFixture,
): Promise<string> {
  const token = await securityAdmin(owner, tenant);
  const headers = { authorization: `Bearer ${token}` };
  const on = await server.patch(
    '/settings/member-recognition',
    { signed_identity_enabled: true },
    headers,
  );
  expect(on.statusCode, on.body).toBe(200);
  const issued = await server.post('/settings/member-recognition/identity-secret', {}, headers);
  expect(issued.statusCode, issued.body).toBe(200);
  return (issued.json() as { identity_secret: string }).identity_secret;
}

/** The database's clock in Unix seconds — what a signature's age is measured against. */
export async function dbSeconds(owner: PrismaClient): Promise<number> {
  const [row] = await owner.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return Math.floor(row!.now.getTime() / 1000);
}

/** What the page hands identify: the fields and their signature, signed at `ts`. */
export function signedIdentity(
  secret: string,
  fields: { userId: string; username?: string; email?: string; ts: number },
): SignedIdentityPayload {
  return {
    user_id: fields.userId,
    ...(fields.username !== undefined ? { username: fields.username } : {}),
    ...(fields.email !== undefined ? { email: fields.email } : {}),
    ts: fields.ts,
    user_hash: signIdentity(secret, fields),
  };
}
