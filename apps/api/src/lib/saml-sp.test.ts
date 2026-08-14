/**
 * The service-provider halves of a SAML login (NFR-S11 · S11-d).
 *
 * Two questions live in `saml-sp.ts`, and both are worth pinning without a
 * server in the way:
 *
 *   - **Who does a believed assertion name?** This is where a workspace's IdP
 *     configuration decides *which account* a login lands on, so every way it
 *     can be ambiguous has to be a refusal rather than a first-wins guess.
 *   - **What do we send to start a login?** A malformed AuthnRequest fails at
 *     the far end as an unexplained IdP error, which is the hardest kind of bug
 *     to diagnose from this side of the redirect.
 *
 * Rejections first for the identity mapping: it is the authorization-relevant
 * half.
 */
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildAuthnRequest,
  resolveSsoIdentity,
  ssoAcsUrl,
  ssoEntityId,
  SSO_NAME_MAX_LENGTH,
} from './saml-sp.js';

const EMAIL_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const TRANSIENT_FORMAT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';

/** An assertion as `verifySamlResponse` hands it over, minus what is unread here. */
function assertion(
  overrides: {
    attributes?: Record<string, string[]>;
    nameId?: string | null;
    nameIdFormat?: string | null;
  } = {},
) {
  return {
    attributes: overrides.attributes ?? {},
    nameId: overrides.nameId ?? null,
    nameIdFormat: overrides.nameIdFormat ?? null,
  };
}

/** The resolved address, or `rejected:<reason>`. Keeps the assertions one-line. */
function verdict(
  input: Parameters<typeof resolveSsoIdentity>[0],
  mapping: Parameters<typeof resolveSsoIdentity>[1] = {},
): string {
  const result = resolveSsoIdentity(input, mapping);
  return result.ok ? result.identity.email : `rejected:${result.reason}`;
}

describe('resolveSsoIdentity', () => {
  // --- Rejections -----------------------------------------------------------

  it('refuses an assertion that names no address', () => {
    expect(verdict(assertion())).toBe('rejected:email_missing');
    expect(verdict(assertion({ attributes: { department: ['support'] } }))).toBe(
      'rejected:email_missing',
    );
    // Present but blank is the same as absent — an IdP emitting an empty
    // AttributeValue has told us nothing.
    expect(verdict(assertion({ attributes: { email: ['   '] } }))).toBe('rejected:email_missing');
  });

  it('refuses two addresses rather than picking one', () => {
    // The whole point: with first-wins, *which* account a login reaches would
    // depend on the order an IdP happened to serialise its attributes in.
    expect(
      verdict(assertion({ attributes: { email: ['a@corp.example', 'b@corp.example'] } })),
    ).toBe('rejected:email_ambiguous');
  });

  it('refuses something that is not an address', () => {
    expect(verdict(assertion({ attributes: { email: ['not-an-address'] } }))).toBe(
      'rejected:email_invalid',
    );
    expect(verdict(assertion({ attributes: { email: ['agent@localhost'] } }))).toBe(
      'rejected:email_invalid',
    );
    expect(verdict(assertion({ attributes: { email: ['two@at@corp.example'] } }))).toBe(
      'rejected:email_invalid',
    );
    expect(verdict(assertion({ attributes: { email: [`${'a'.repeat(320)}@corp.example`] } }))).toBe(
      'rejected:email_invalid',
    );
  });

  it('refuses a NameID that is not declared to be an address', () => {
    // A transient or persistent NameID is an opaque pairwise handle. Reading one
    // as a mailbox would invent an account named after a value the IdP is free
    // to change on every login.
    expect(
      verdict(assertion({ nameId: 'agent@corp.example', nameIdFormat: TRANSIENT_FORMAT })),
    ).toBe('rejected:email_missing');
  });

  it('uses a configured attribute alone, and does not fall back to another', () => {
    const both = assertion({
      attributes: { mail: ['mapped@corp.example'], email: ['default@corp.example'] },
    });
    expect(verdict(both, { email: 'mail' })).toBe('mapped@corp.example');
    // The mapped attribute is missing: falling through to `email` would let a
    // second claim decide who signs in, after an admin explicitly chose one.
    expect(
      verdict(assertion({ attributes: { email: ['default@corp.example'] } }), {
        email: 'mail',
      }),
    ).toBe('rejected:email_missing');
    // Nor to the NameID — same argument, and this is the one that bites, since
    // an IdP almost always puts *an* address there. Silently signing somebody in
    // as their NameID would look identical to the mapping having worked.
    expect(
      verdict(assertion({ nameId: 'subject@corp.example', nameIdFormat: EMAIL_FORMAT }), {
        email: 'mail',
      }),
    ).toBe('rejected:email_missing');
  });

  // --- Acceptances ----------------------------------------------------------

  it('reads the attribute names enterprise IdPs actually emit', () => {
    expect(verdict(assertion({ attributes: { email: ['agent@corp.example'] } }))).toBe(
      'agent@corp.example',
    );
    // Shibboleth / SimpleSAMLphp
    expect(
      verdict(
        assertion({ attributes: { 'urn:oid:0.9.2342.19200300.100.1.3': ['agent@corp.example'] } }),
      ),
    ).toBe('agent@corp.example');
    // Azure AD / ADFS
    expect(
      verdict(
        assertion({
          attributes: {
            'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': [
              'agent@corp.example',
            ],
          },
        }),
      ),
    ).toBe('agent@corp.example');
  });

  it('falls back to an email-format NameID, and to an unformatted one', () => {
    expect(verdict(assertion({ nameId: 'agent@corp.example', nameIdFormat: EMAIL_FORMAT }))).toBe(
      'agent@corp.example',
    );
    // Unspecified is the spec's default, and every IdP this targets puts the
    // address there when it puts one anywhere.
    expect(verdict(assertion({ nameId: 'agent@corp.example', nameIdFormat: null }))).toBe(
      'agent@corp.example',
    );
  });

  it('normalises the address the way accounts.email compares', () => {
    // `accounts.email` is citext, so an IdP shouting the address must not create
    // a second person.
    expect(verdict(assertion({ attributes: { email: ['  Agent@Corp.Example  '] } }))).toBe(
      'agent@corp.example',
    );
  });

  it('carries a display name, and shrugs off a bad one', () => {
    const named = resolveSsoIdentity(
      assertion({ attributes: { email: ['agent@corp.example'], displayName: ['  Ada L.  '] } }),
      {},
    );
    expect(named.ok && named.identity.name).toBe('Ada L.');

    const mapped = resolveSsoIdentity(
      assertion({ attributes: { email: ['agent@corp.example'], cn: ['Ada Lovelace'] } }),
      { name: 'cn' },
    );
    expect(mapped.ok && mapped.identity.name).toBe('Ada Lovelace');

    // A second name decides nothing, so it is dropped rather than failing a
    // login the address was perfectly clear about.
    const ambiguous = resolveSsoIdentity(
      assertion({ attributes: { email: ['agent@corp.example'], name: ['A', 'B'] } }),
      {},
    );
    expect(ambiguous.ok && ambiguous.identity.name).toBeNull();

    const long = resolveSsoIdentity(
      assertion({ attributes: { email: ['agent@corp.example'], name: ['N'.repeat(500)] } }),
      {},
    );
    expect(long.ok && long.identity.name).toHaveLength(SSO_NAME_MAX_LENGTH);
  });
});

// --- Starting a login --------------------------------------------------------

const API_BASE = 'https://api.nexa.test/api/v1';
const CONNECTION = '0b4dd3f0-1c2b-4f5a-9d6e-7a8b9c0d1e2f';

/** The AuthnRequest as the IdP will read it: inflated back out of the redirect. */
function decodeRequest(redirectUrl: string): { xml: string; relayState: string | null } {
  const url = new URL(redirectUrl);
  const encoded = url.searchParams.get('SAMLRequest') ?? '';
  return {
    xml: inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8'),
    relayState: url.searchParams.get('RelayState'),
  };
}

describe('buildAuthnRequest', () => {
  const input = {
    idpSsoUrl: 'https://idp.example.test/saml/sso',
    spEntityId: ssoEntityId(API_BASE, CONNECTION),
    acsUrl: ssoAcsUrl(API_BASE, CONNECTION),
    relayState: '_relay',
    issueInstant: new Date('2026-08-14T10:00:00.000Z'),
  };

  it('addresses the request to us and to the IdP', () => {
    const { xml } = decodeRequest(buildAuthnRequest(input).redirectUrl);

    expect(xml).toContain(`Destination="${input.idpSsoUrl}"`);
    expect(xml).toContain(`AssertionConsumerServiceURL="${input.acsUrl}"`);
    expect(xml).toContain(`<saml:Issuer>${input.spEntityId}</saml:Issuer>`);
    expect(xml).toContain('IssueInstant="2026-08-14T10:00:00.000Z"');
    // AllowCreate is what lets an IdP mint a NameID for somebody who has never
    // signed in here — the case JIT provisioning exists for.
    expect(xml).toContain('AllowCreate="true"');
  });

  it('gives the request an id the response has to echo', () => {
    const first = buildAuthnRequest(input);
    const second = buildAuthnRequest(input);

    // `xs:ID` is an NCName, so it may not start with a digit.
    expect(first.id).toMatch(/^_[0-9a-f]{32}$/);
    expect(first.id).not.toBe(second.id);
    expect(decodeRequest(first.redirectUrl).xml).toContain(`ID="${first.id}"`);
  });

  it('carries the relay handle and keeps the IdP URL intact', () => {
    // Several IdPs route on a query parameter of their own; assigning the search
    // string instead of appending would silently drop it and the request would
    // arrive at the wrong tenant of the IdP.
    const routed = buildAuthnRequest({
      ...input,
      idpSsoUrl: 'https://idp.example.test/saml/sso?tenant=corp',
    });
    const url = new URL(routed.redirectUrl);

    expect(url.searchParams.get('tenant')).toBe('corp');
    expect(url.searchParams.get('RelayState')).toBe('_relay');
    expect(url.searchParams.get('SAMLRequest')).not.toBeNull();
  });

  it('escapes a URL that would otherwise break the document', () => {
    const routed = buildAuthnRequest({
      ...input,
      idpSsoUrl: 'https://idp.example.test/saml/sso?a=1&b=2',
    });
    const { xml } = decodeRequest(routed.redirectUrl);

    // A bare `&` here produces XML the IdP cannot parse, and the failure shows
    // up at the far end as an unexplained rejection.
    expect(xml).toContain('Destination="https://idp.example.test/saml/sso?a=1&amp;b=2"');
    expect(xml).not.toContain('?a=1&b=2');
  });
});

describe('ssoEntityId / ssoAcsUrl', () => {
  it('names one connection, not the deployment', () => {
    // Per connection is what makes an assertion minted for one workspace fail
    // at every other workspace's ACS on both `Audience` and `Destination`, even
    // when the two federate the same identity provider.
    expect(ssoEntityId(API_BASE, CONNECTION)).toBe(
      `https://api.nexa.test/api/v1/auth/saml/${CONNECTION}`,
    );
    expect(ssoAcsUrl(API_BASE, CONNECTION)).toBe(`${ssoEntityId(API_BASE, CONNECTION)}/acs`);
    expect(ssoEntityId(API_BASE, 'other')).not.toBe(ssoEntityId(API_BASE, CONNECTION));
  });
});
