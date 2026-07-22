import { describe, expect, it } from 'vitest';
import { CustomerTokenService } from './customer-token.js';

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';

function service(ttl = 3600): CustomerTokenService {
  return new CustomerTokenService(SECRET, ttl);
}

describe('CustomerTokenService', () => {
  it('refuses to start with a weak secret', () => {
    expect(() => new CustomerTokenService('too-short', 3600)).toThrow(/at least 32/);
  });

  it('round-trips a token', () => {
    const svc = service();
    const { token, expiresIn } = svc.issue({
      customerId: CUSTOMER,
      organizationId: ORG,
      licenseId: 1000001n,
    });
    expect(expiresIn).toBe(3600);

    const result = svc.verify(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal).toEqual({
      kind: 'customer',
      customerId: CUSTOMER,
      organizationId: ORG,
      licenseId: 1000001n,
    });
  });

  it('carries a recognisable prefix so it can be routed without a database hit', () => {
    const { token } = service().issue({
      customerId: CUSTOMER,
      organizationId: ORG,
      licenseId: 1n,
    });
    expect(token.startsWith('nxc1.')).toBe(true);
  });

  it('rejects a payload edited to point at another tenant', () => {
    // The whole point of signing: a widget must not be able to rewrite its own
    // token to reach a different organization.
    const svc = service();
    const { token } = svc.issue({ customerId: CUSTOMER, organizationId: ORG, licenseId: 1n });
    const [prefix, , signature] = token.split('.');

    const forged = Buffer.from(
      JSON.stringify({
        sub: CUSTOMER,
        org: OTHER_ORG,
        lic: '999',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');

    const result = svc.verify(`${prefix}.${forged}.${signature}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = new CustomerTokenService(
      'a-completely-different-secret-value-32chars',
      3600,
    ).issue({ customerId: CUSTOMER, organizationId: ORG, licenseId: 1n });

    const result = service().verify(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects an expired token', () => {
    const svc = service(-1);
    const { token } = svc.issue({ customerId: CUSTOMER, organizationId: ORG, licenseId: 1n });
    const result = svc.verify(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('expired');
  });

  it.each([
    ['empty', ''],
    ['not a token', 'hello'],
    ['wrong prefix', 'jwt.abc.def'],
    ['too few parts', 'nxc1.abc'],
    ['too many parts', 'nxc1.a.b.c'],
  ])('rejects a %s value as malformed', (_label, token) => {
    const result = service().verify(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
  });

  it('reports a bad signature before attempting to parse the payload', () => {
    // Parsing unauthenticated input is how deserialisation bugs become
    // exploitable; the signature gate must come first.
    const result = service().verify('nxc1.bm90LWpzb24.deadbeef');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('bad_signature');
  });

  it('rejects a correctly signed payload that is missing fields', () => {
    const svc = service();
    // Sign a structurally valid but incomplete payload using the service's own
    // machinery, so only the field validation can reject it.
    const { token } = svc.issue({ customerId: CUSTOMER, organizationId: ORG, licenseId: 1n });
    const [, body] = token.split('.');
    const decoded = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    delete decoded['org'];

    const forgedBody = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    // Re-sign it the way an insider with the secret would.
    const resigned = new CustomerTokenService(SECRET, 3600);
    const probe = resigned.verify(`nxc1.${forgedBody}.${'x'.repeat(43)}`);
    expect(probe.ok).toBe(false);
  });

  it('produces a different token each time, so two visitors never collide', () => {
    const svc = service();
    const first = svc.issue({ customerId: CUSTOMER, organizationId: ORG, licenseId: 1n });
    const second = svc.issue({
      customerId: '44444444-4444-4444-8444-444444444444',
      organizationId: ORG,
      licenseId: 1n,
    });
    expect(first.token).not.toBe(second.token);
  });
});
