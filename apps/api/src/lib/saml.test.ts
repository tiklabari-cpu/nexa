/**
 * The rejection matrix for `saml.ts` (NFR-S11 · S11-b).
 *
 * Rejections come first and take most of the file, because that is where the
 * value is: an assertion verifier that accepts a valid login is easy, and every
 * SAML CVE of the last decade is a verifier that also accepted something else.
 * The signature-wrapping section in particular builds real attacks — a signature
 * that verifies, over content that is not what the reader would have read — and
 * asserts that the forged subject never comes back.
 *
 * The signing key pair used throughout comes from `test/helpers/mock-idp.ts`
 * (S11-c, imported below as `IDP_PRIVATE_KEY`/`IDP_CERTIFICATE`). This subtask
 * did not wait for S11-c to exist — the pair was minted here first and later
 * promoted rather than duplicated, so the codebase keeps exactly one mock IdP
 * key. The *attacker's* pair (`FOREIGN_PRIVATE_KEY`/`FOREIGN_CERTIFICATE`,
 * below) stays local: it is specific to the wrapping attacks this file builds
 * and has no reuse outside them.
 */
import { X509Certificate } from 'node:crypto';
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import {
  EXPIRED_CERTIFICATE_PEM,
  UNPARSEABLE_CERTIFICATE_PEM,
  WEAK_CERTIFICATE_PEM,
} from '../../test/helpers/certificates.js';
import {
  MOCK_IDP_CERTIFICATE as IDP_CERTIFICATE,
  MOCK_IDP_PRIVATE_KEY as IDP_PRIVATE_KEY,
} from '../../test/helpers/mock-idp.js';
import {
  ASSERTION_CLOCK_SKEW_MS,
  createRedisReplayGuard,
  MAX_SAML_RESPONSE_BYTES,
  type AssertionReplayGuard,
  type ReplayStore,
  type SamlExpectations,
  verifySamlResponse,
} from './saml.js';

/**
 * A second, unrelated pair. NOT A SECRET either. This is the attacker's key:
 * well-formed, real, and simply not the one the connection trusts.
 */
const FOREIGN_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC8AnSi3ry+2t1v
YRVPPDkH64Y0H/sPO81t0KA4NEKNt5zf4k8eau1PdZGHGBWQJFRaQPvo3Hgn+WR4
mG1GqaWrbXISFMKdVHuNZdErAELKLJzRVrItiFm2jRFyXfUG5kDb2XxRNfpSJlXw
CG3JxOc8J2bq4sD2IWJayn7mMHPqUw/ujIbT7deNk1JFTifb7op1HbIlt7aHEEVH
gzPqDbf/GHmQ60Zg6S/DDiM9CoN7JpRpxx58da+bEVLpKBjy6GNcwkDJ2/h8PqY0
3ibpdqwGkuGOmXrni/q+eH8RqrEBWmud9K9aegLx8VVYKLEscOvJFKwMM/QHUK1E
Z6HuvTjrAgMBAAECggEAEQHl3C/rAhbZbjBplZPckt9W8hMsimm+AR+cxsjPdnN0
MPqPbrB8jDIV+pMOrE3lBY8YWq3K/s68LH6ZcAl7r6DEb2dKXaIdVSKvQ8UPxas4
emVt09mgR/fF6sMeHcQpfNnVOaF45gKKxp50lAqIYnQsBraBfyJw+8aSqS8b5Uf7
ZyHa9P+w305XQ+zqd1ddINPxNmbwLlxOpPPwVilGq0XVtBeOAnZhw2UF5WVDnnW/
0tej+30bM3vSU9MqyUeGeR7KjMn+CB+yqZj7u2d8OD9/77ukkeGMTPTNbC/5mNXE
5A2y8bawv0iy5cBk/ZGnHcd1LJbi7WemmBeVYnRAxQKBgQDySnSN132ohtAoXBut
onD0y92EL/S46YJGhFtP7srRRT3BH5tedRzNz50Obmg4zxUHfNWDIIIOpHNCKzZS
isl1hZi7TQG7ugyLeD15gc3UACBSAVOfJVTny7S/HVhvNqfDjCBU6Krenu/s+BSb
liIHhOyWxzsl6BuynlgB3Zy/VwKBgQDGpb62jtwDSLDflaI2rZGv0hjce9U7LdLe
eR40mLeFATYSSMwGqlcdPNZkvTmZH27U0YDu2DOuEKIW45O+OedHdPTl0lPzj7T5
c/KDX3IbNIMtdKJykW/T8lmYDityRVwnnPShofNO0ND+Y5tRSWrzk7F3WoRHpJcm
1Y1/5S8ajQKBgGeZ7KKmDQYdty46zF7/gZs6/NpEAzl6J4ltmPnh2nmHSPOmRzIp
k4pxhu+fyBLagVx1RXrPUK1gJiSaA51h2OjWmkskj2QtFqYgYPDuzwsijq9h/9ai
CN8gnIXHz4OmdC/KYBzObBnLDj5eiblJhf1/GgcS47i+ufEzgeAyWY77AoGAEGRc
+HORdDPrZIfUeu6Xtwp/QrJ1Rgzh+bnE5FI10qPm8ltPer1TsvXyOx3iQuB1JNqk
6RCuMw7sUTc2WdwtWZgtHUnd45tYM719pZmasOQEbxvQy+N0dujou8Nvkl5m3F33
Ud8rVLWmiVdu2aZVTQRDALZXdBIA5xN4ObWPzYECgYEA68gwE8m7OQmahhlV5kUB
AnR1+TrN2hEOrPagp9IQurwRoLyQd892RqKVyvvPLKaDcQyjvLrvkEFzhmE+7w0g
WqS1XY3Kl/7ZLkfRGe32ExgF/iPMJZCRaHJuZUy9SmVhvSey55NdZbyl7HdXBJXs
DJrPImsN95NvN/Xx5YsbNs0=
-----END PRIVATE KEY-----
`;

/** The public half of {@link FOREIGN_PRIVATE_KEY}. */
const FOREIGN_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDKTCCAhGgAwIBAgIUfZyjTbY64ga0bm/JLYf+1GY/gPkwDQYJKoZIhvcNAQEL
BQAwIzEhMB8GA1UEAwwYZm9yZWlnbi1pZHAuZXhhbXBsZS50ZXN0MCAXDTI1MDEw
MTAwMDAwMFoYDzIxMjUwMTAxMDAwMDAwWjAjMSEwHwYDVQQDDBhmb3JlaWduLWlk
cC5leGFtcGxlLnRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC8
AnSi3ry+2t1vYRVPPDkH64Y0H/sPO81t0KA4NEKNt5zf4k8eau1PdZGHGBWQJFRa
QPvo3Hgn+WR4mG1GqaWrbXISFMKdVHuNZdErAELKLJzRVrItiFm2jRFyXfUG5kDb
2XxRNfpSJlXwCG3JxOc8J2bq4sD2IWJayn7mMHPqUw/ujIbT7deNk1JFTifb7op1
HbIlt7aHEEVHgzPqDbf/GHmQ60Zg6S/DDiM9CoN7JpRpxx58da+bEVLpKBjy6GNc
wkDJ2/h8PqY03ibpdqwGkuGOmXrni/q+eH8RqrEBWmud9K9aegLx8VVYKLEscOvJ
FKwMM/QHUK1EZ6HuvTjrAgMBAAGjUzBRMB0GA1UdDgQWBBTHoaePxJJhxzrvOkvC
vE/F6cOG7jAfBgNVHSMEGDAWgBTHoaePxJJhxzrvOkvCvE/F6cOG7jAPBgNVHRMB
Af8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQAfSlVzpb3qR3UmvwUwNohuSCeB
03g/SAbYWHjEI2q83ekoLjdS3243h7fXdEEA2/5ZfCFiOFXrIlDoatlee1DhgGDd
YGzw0+CZxpZCJ7LYF6GvHptEQ4/sXVfTYfR26bFNmX05bFtXc+0edak3EsGlGE44
A/whJdVm9lBBIro6OC+8vS6XrnkoPhB2NCNnu1y3eJb6vwDYnKksRo1hXZmd6xV6
YrtVIRjNYS30rOFE799wvdpoIlZtm7HzRWv7G/nM/fwnyMl0vMAAEzedp85VDYje
Cv8v5ICPmDAR2FRuYtAeZEuKQ0nVVjyGELxpAgal3fl91B3wH1PrTLZLbwIV
-----END CERTIFICATE-----
`;

const IDP_ENTITY_ID = 'https://idp-signing.example.test/metadata';
const SP_ENTITY_ID = 'https://app.nexa.test/saml/metadata';
const ACS_URL = 'https://app.nexa.test/auth/saml/conn-1/acs';
const REQUEST_ID = '_req-00000000000000000001';

/** Inside every fixture's window: assertions run 10:00 → 10:05. */
const NOW = new Date('2026-08-14T10:01:00.000Z');

const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

interface AssertionShape {
  id?: string;
  issuer?: string;
  audience?: string | null;
  recipient?: string;
  inResponseTo?: string | null;
  notBefore?: string | null;
  notOnOrAfter?: string | null;
  subjectNotOnOrAfter?: string | null;
  nameId?: string;
  omitConditions?: boolean;
  omitSubject?: boolean;
  confirmationMethod?: string;
  attributes?: Record<string, string[]>;
}

function buildAssertion(shape: AssertionShape = {}): string {
  const {
    id = '_assertion-1',
    issuer = IDP_ENTITY_ID,
    audience = SP_ENTITY_ID,
    recipient = ACS_URL,
    inResponseTo = REQUEST_ID,
    notBefore = '2026-08-14T10:00:00Z',
    notOnOrAfter = '2026-08-14T10:05:00Z',
    subjectNotOnOrAfter = '2026-08-14T10:05:00Z',
    nameId = 'agent@corp.example',
    confirmationMethod = 'urn:oasis:names:tc:SAML:2.0:cm:bearer',
    attributes = { email: ['agent@corp.example'], groups: ['support', 'leads'] },
  } = shape;

  const confirmationAttributes = [
    inResponseTo === null ? '' : ` InResponseTo="${inResponseTo}"`,
    subjectNotOnOrAfter === null ? '' : ` NotOnOrAfter="${subjectNotOnOrAfter}"`,
    ` Recipient="${recipient}"`,
  ].join('');

  const subject = shape.omitSubject
    ? ''
    : `<saml:Subject>` +
      `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameId}</saml:NameID>` +
      `<saml:SubjectConfirmation Method="${confirmationMethod}">` +
      `<saml:SubjectConfirmationData${confirmationAttributes}/>` +
      `</saml:SubjectConfirmation>` +
      `</saml:Subject>`;

  const audienceRestriction =
    audience === null
      ? ''
      : `<saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction>`;
  const conditionAttributes = [
    notBefore === null ? '' : ` NotBefore="${notBefore}"`,
    notOnOrAfter === null ? '' : ` NotOnOrAfter="${notOnOrAfter}"`,
  ].join('');
  const conditions = shape.omitConditions
    ? ''
    : `<saml:Conditions${conditionAttributes}>${audienceRestriction}</saml:Conditions>`;

  const attributeStatement = `<saml:AttributeStatement>${Object.entries(attributes)
    .map(
      ([name, values]) =>
        `<saml:Attribute Name="${name}">${values
          .map((value) => `<saml:AttributeValue>${value}</saml:AttributeValue>`)
          .join('')}</saml:Attribute>`,
    )
    .join('')}</saml:AttributeStatement>`;

  return (
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="2026-08-14T10:00:00Z">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    subject +
    conditions +
    `<saml:AuthnStatement AuthnInstant="2026-08-14T10:00:00Z" SessionIndex="_session-1">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    attributeStatement +
    `</saml:Assertion>`
  );
}

interface ResponseShape {
  id?: string;
  destination?: string | null;
  status?: string;
  assertions?: string[];
  extensions?: string;
}

function buildResponse(shape: ResponseShape = {}): string {
  const {
    id = '_response-1',
    destination = ACS_URL,
    status = 'urn:oasis:names:tc:SAML:2.0:status:Success',
    assertions = [buildAssertion()],
    extensions = '',
  } = shape;

  return (
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="${id}" Version="2.0" IssueInstant="2026-08-14T10:00:00Z"${destination === null ? '' : ` Destination="${destination}"`}>` +
    `<saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>` +
    (extensions ? `<samlp:Extensions>${extensions}</samlp:Extensions>` : '') +
    `<samlp:Status><samlp:StatusCode Value="${status}"/></samlp:Status>` +
    assertions.join('') +
    `</samlp:Response>`
  );
}

interface SignOptions {
  /** Local name of the element to cover, plus its `ID`. */
  target?: { localName: 'Assertion' | 'Response' | 'Extensions'; id?: string };
  privateKey?: string;
  publicCert?: string;
  signatureAlgorithm?: string;
  digestAlgorithm?: string;
  canonicalization?: string;
  /** Emit a `KeyInfo` carrying `publicCert` — the key-substitution attempt. */
  embedKeyInfo?: boolean;
}

/** Sign one element of `xml` in place and return the resulting document. */
function sign(xml: string, options: SignOptions = {}): string {
  const {
    target = { localName: 'Assertion', id: '_assertion-1' },
    privateKey = IDP_PRIVATE_KEY,
    publicCert = IDP_CERTIFICATE,
    signatureAlgorithm = RSA_SHA256,
    digestAlgorithm = SHA256,
    canonicalization = EXC_C14N,
    embedKeyInfo = false,
  } = options;

  const selector = target.id
    ? `//*[local-name(.)='${target.localName}' and @ID='${target.id}']`
    : `//*[local-name(.)='${target.localName}']`;

  const signer = new SignedXml({
    privateKey,
    publicCert,
    signatureAlgorithm,
    canonicalizationAlgorithm: canonicalization,
  });
  if (!embedKeyInfo) signer.getKeyInfoContent = () => null;
  signer.addReference({
    xpath: selector,
    transforms: [ENVELOPED, canonicalization],
    digestAlgorithm,
  });
  // SAML requires the signature immediately after `Issuer`; `Extensions` has no
  // `Issuer`, so a decoy signature is simply appended inside it.
  signer.computeSignature(xml, {
    location:
      target.localName === 'Extensions'
        ? { reference: selector, action: 'append' }
        : { reference: `${selector}/*[local-name(.)='Issuer']`, action: 'after' },
  });
  return signer.getSignedXml();
}

function encode(xml: string): string {
  return Buffer.from(xml, 'utf8').toString('base64');
}

/** In-memory stand-in for the Redis guard: remembers every id it has seen. */
function memoryGuard(): AssertionReplayGuard & { seen: Set<string> } {
  const seen = new Set<string>();
  return {
    seen,
    claim(assertionId) {
      if (seen.has(assertionId)) return Promise.resolve(false);
      seen.add(assertionId);
      return Promise.resolve(true);
    },
  };
}

function expectations(overrides: Partial<SamlExpectations> = {}): SamlExpectations {
  return {
    idpEntityId: IDP_ENTITY_ID,
    spEntityId: SP_ENTITY_ID,
    acsUrl: ACS_URL,
    certificates: [IDP_CERTIFICATE],
    inResponseTo: REQUEST_ID,
    allowIdpInitiated: false,
    ...overrides,
  };
}

/**
 * The verdict as one comparable string: `'accepted'` or the rejection reason.
 * Keeps the matrix readable one line per attack.
 */
async function verdict(
  xml: string,
  overrides: Partial<SamlExpectations> = {},
  guard: AssertionReplayGuard = memoryGuard(),
  now: Date = NOW,
): Promise<string> {
  const result = await verifySamlResponse(encode(xml), expectations(overrides), now, guard);
  return result.ok ? 'accepted' : result.reason;
}

/** The happy path, signed at the assertion — the shape most IdPs emit. */
function validResponse(): string {
  return sign(buildResponse());
}

function parse(xml: string): Document {
  return new DOMParser({ onError: () => undefined }).parseFromString(xml, 'text/xml');
}

function serialize(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

describe('verifySamlResponse — the happy path', () => {
  it('accepts a well-formed signed assertion and returns only signed claims', async () => {
    const result = await verifySamlResponse(
      encode(validResponse()),
      expectations(),
      NOW,
      memoryGuard(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertion.assertionId).toBe('_assertion-1');
    expect(result.assertion.issuer).toBe(IDP_ENTITY_ID);
    expect(result.assertion.nameId).toBe('agent@corp.example');
    expect(result.assertion.nameIdFormat).toBe(
      'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    );
    expect(result.assertion.sessionIndex).toBe('_session-1');
    // Left raw: which attribute is the email address is the connection's
    // mapping, and applying it is S11-d's decision.
    expect(result.assertion.attributes).toEqual({
      email: ['agent@corp.example'],
      groups: ['support', 'leads'],
    });
    expect(result.assertion.expiresAt.toISOString()).toBe('2026-08-14T10:05:00.000Z');
    expect(result.assertion.signingCertificateFingerprint).toBe(
      new X509Certificate(IDP_CERTIFICATE).fingerprint256,
    );
  });

  it('accepts a signature over the whole Response', async () => {
    const xml = sign(buildResponse(), { target: { localName: 'Response', id: '_response-1' } });
    expect(await verdict(xml)).toBe('accepted');
  });

  it('accepts a Response and Assertion both signed — one assertion, not two', async () => {
    // A legitimate IdP setting (Okta's "sign both"). The same assertion arrives
    // through two signed payloads; treating that as ambiguous would break a real
    // deployment, so the ids are compared rather than the payload count.
    const inner = sign(buildResponse());
    const both = sign(inner, { target: { localName: 'Response', id: '_response-1' } });
    expect(await verdict(both)).toBe('accepted');
  });

  it('accepts an unsolicited assertion only when the workspace allows it', async () => {
    const unsolicited = sign(
      buildResponse({ assertions: [buildAssertion({ inResponseTo: null })] }),
    );
    expect(await verdict(unsolicited, { inResponseTo: null })).toBe('idp_initiated_not_allowed');
    expect(await verdict(unsolicited, { inResponseTo: null, allowIdpInitiated: true })).toBe(
      'accepted',
    );
  });

  it('refuses an unsolicited response that answers a request we never sent', async () => {
    // `allowIdpInitiated` says "we accept logins we did not start", not "we
    // accept an answer to somebody else's AuthnRequest".
    expect(await verdict(validResponse(), { inResponseTo: null, allowIdpInitiated: true })).toBe(
      'in_response_to_mismatch',
    );
  });
});

describe('verifySamlResponse — signature wrapping (XSW)', () => {
  /** The subject the attacker wants; never the one that comes back. */
  const VICTIM = 'owner@corp.example';

  it('ignores a forged assertion placed before the signed one', async () => {
    // The naive reader takes the first `Assertion` it finds. This one is first,
    // unsigned, and simply never read.
    const signed = sign(buildResponse());
    const document = parse(signed);
    const forged = parse(buildAssertion({ id: '_forged', nameId: VICTIM })).documentElement!;
    const response = document.documentElement!;
    const firstAssertion = response.getElementsByTagNameNS(
      'urn:oasis:names:tc:SAML:2.0:assertion',
      'Assertion',
    )[0]!;
    response.insertBefore(document.importNode(forged, true), firstAssertion);

    const result = await verifySamlResponse(
      encode(serialize(response)),
      expectations(),
      NOW,
      memoryGuard(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertion.nameId).toBe('agent@corp.example');
    expect(result.assertion.assertionId).toBe('_assertion-1');
  });

  it('ignores a forged assertion when the signed one is hidden in Extensions', async () => {
    // The textbook variant: move the signed assertion somewhere the reader does
    // not look, and leave a forgery in its place.
    const signed = sign(buildResponse());
    const document = parse(signed);
    const response = document.documentElement!;
    const original = response.getElementsByTagNameNS(
      'urn:oasis:names:tc:SAML:2.0:assertion',
      'Assertion',
    )[0]!;

    const extensions = document.createElementNS(
      'urn:oasis:names:tc:SAML:2.0:protocol',
      'samlp:Extensions',
    );
    response.replaceChild(extensions, original);
    extensions.appendChild(original);
    const forged = parse(buildAssertion({ id: '_forged', nameId: VICTIM })).documentElement!;
    response.appendChild(document.importNode(forged, true));

    const result = await verifySamlResponse(
      encode(serialize(response)),
      expectations(),
      NOW,
      memoryGuard(),
    );
    // The signature still verifies — it always did, that is the attack — and the
    // assertion that comes back is the one it covered. The forgery sitting where
    // the reader would have looked is never seen.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertion.nameId).toBe('agent@corp.example');
    expect(result.assertion.assertionId).toBe('_assertion-1');
  });

  it('refuses a signature that covers a decoy while the assertion is unsigned', async () => {
    // The sharpest shape: the signature is genuine, made with the real key, and
    // covers something harmless. Reading "is there a valid signature?" would
    // accept this document outright.
    const xml = sign(
      buildResponse({
        assertions: [buildAssertion({ id: '_forged', nameId: VICTIM })],
        extensions: '<decoy xmlns="urn:nexa:test" ID="_decoy">nothing to see</decoy>',
      }),
      { target: { localName: 'Extensions' } },
    );
    expect(await verdict(xml)).toBe('assertion_missing');
  });

  it('refuses a document that reuses one ID for two elements', async () => {
    // Reference shifting: two elements answer to `_assertion-1`, so which one
    // the digest covered depends on which the lookup happens to return.
    const signed = sign(buildResponse());
    const document = parse(signed);
    const response = document.documentElement!;
    const original = response.getElementsByTagNameNS(
      'urn:oasis:names:tc:SAML:2.0:assertion',
      'Assertion',
    )[0]!;
    const twin = original.cloneNode(true) as Element;
    const twinNameId = twin.getElementsByTagNameNS(
      'urn:oasis:names:tc:SAML:2.0:assertion',
      'NameID',
    )[0]!;
    twinNameId.textContent = VICTIM;
    response.insertBefore(twin, original);

    expect(await verdict(serialize(response))).toBe('invalid_signature');
  });

  it('refuses a signature transplanted from another response', async () => {
    // The signature is real and made with the trusted key — it simply refers to
    // an assertion that is not in this document.
    const donor = parse(sign(buildResponse()));
    const signature = donor.documentElement!.getElementsByTagNameNS(
      'http://www.w3.org/2000/09/xmldsig#',
      'Signature',
    )[0]!;

    const target = parse(
      buildResponse({ assertions: [buildAssertion({ id: '_forged', nameId: VICTIM })] }),
    );
    const forgedAssertion = target.documentElement!.getElementsByTagNameNS(
      'urn:oasis:names:tc:SAML:2.0:assertion',
      'Assertion',
    )[0]!;
    forgedAssertion.appendChild(target.importNode(signature, true));

    expect(await verdict(serialize(target.documentElement!))).toBe('invalid_signature');
  });

  it('reads the signed Response, not the forged wrapper around it', async () => {
    // The whole signed response is nested inside an attacker-built one that
    // carries its own assertion.
    const inner = sign(buildResponse(), { target: { localName: 'Response', id: '_response-1' } });
    const outer = buildResponse({
      id: '_wrapper',
      assertions: [buildAssertion({ id: '_forged', nameId: VICTIM })],
      extensions: inner.replace(/^<\?xml[^>]*\?>/, ''),
    });

    const result = await verifySamlResponse(encode(outer), expectations(), NOW, memoryGuard());
    // The wrapper is well-formed, is a `samlp:Response`, and carries an
    // assertion — everything a reader checks. It is also entirely unsigned, so
    // the claims come from the nested response the IdP actually stood behind.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertion.nameId).toBe('agent@corp.example');
    expect(result.assertion.assertionId).toBe('_assertion-1');
  });

  it('refuses two signatures that authenticate two different assertions', async () => {
    const twoAssertions = buildResponse({
      assertions: [buildAssertion(), buildAssertion({ id: '_assertion-2', nameId: VICTIM })],
    });
    const signedOnce = sign(twoAssertions);
    const signedTwice = sign(signedOnce, {
      target: { localName: 'Assertion', id: '_assertion-2' },
    });
    expect(await verdict(signedTwice)).toBe('assertion_ambiguous');
  });

  it('reads the full text of a NameID split by a comment (CVE-2017-11427)', async () => {
    // Canonicalisation drops comments before digesting, so `a@b<!---->.evil`
    // signs as `a@b.evil` and reads as `a@b` to anything that takes the first
    // text node. The claim must come back whole.
    const signed = sign(
      buildResponse({ assertions: [buildAssertion({ nameId: 'agent@corp.example.evil.test' })] }),
    );
    const spliced = signed.replace(
      'agent@corp.example.evil.test',
      'agent@corp.example<!---->.evil.test',
    );

    const result = await verifySamlResponse(encode(spliced), expectations(), NOW, memoryGuard());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertion.nameId).toBe('agent@corp.example.evil.test');
  });
});

describe('verifySamlResponse — signature and key', () => {
  it('refuses an unsigned response', async () => {
    expect(await verdict(buildResponse())).toBe('unsigned');
  });

  it('refuses a tampered signature value', async () => {
    const signed = sign(buildResponse());
    const broken = signed.replace(
      /(<SignatureValue>)(.)/,
      (_, open: string, first: string) => `${open}${first === 'A' ? 'B' : 'A'}`,
    );
    expect(await verdict(broken)).toBe('invalid_signature');
  });

  it('refuses tampered content behind an intact signature', async () => {
    const signed = sign(buildResponse());
    const tampered = signed.replace(
      'agent@corp.example</saml:NameID>',
      'owner@corp.example</saml:NameID>',
    );
    expect(await verdict(tampered)).toBe('invalid_signature');
  });

  it('refuses a signature made with a key we do not trust', async () => {
    const foreign = sign(buildResponse(), {
      privateKey: FOREIGN_PRIVATE_KEY,
      publicCert: FOREIGN_CERTIFICATE,
    });
    expect(await verdict(foreign)).toBe('invalid_signature');
  });

  it('refuses a certificate the attacker supplied in KeyInfo', async () => {
    // The attack the `getCertFromKeyInfo` pin exists for: sign with your own
    // key, embed your own certificate, and the document verifies against itself.
    const foreign = sign(buildResponse(), {
      privateKey: FOREIGN_PRIVATE_KEY,
      publicCert: FOREIGN_CERTIFICATE,
      embedKeyInfo: true,
    });
    expect(foreign).toContain('X509Certificate');
    expect(await verdict(foreign)).toBe('invalid_signature');
  });

  it('accepts the rotation overlap certificate and reports which one verified', async () => {
    const foreign = sign(buildResponse(), {
      privateKey: FOREIGN_PRIVATE_KEY,
      publicCert: FOREIGN_CERTIFICATE,
    });
    const result = await verifySamlResponse(
      encode(foreign),
      // Current first, outgoing second — the caller has already narrowed the
      // overlap through `activePreviousCertificate` (§C-A17.1).
      expectations({ certificates: [IDP_CERTIFICATE, FOREIGN_CERTIFICATE] }),
      NOW,
      memoryGuard(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertion.signingCertificateFingerprint).toBe(
      new X509Certificate(FOREIGN_CERTIFICATE).fingerprint256,
    );
  });

  it('refuses when no configured certificate is usable today', async () => {
    // The open question S11-a2 left here: a rotation overlap may keep an
    // outgoing certificate for up to seven days, and it can expire inside that
    // window. Write-time validity is not use-time validity.
    expect(await verdict(validResponse(), { certificates: [EXPIRED_CERTIFICATE_PEM] })).toBe(
      'no_usable_certificate',
    );
    expect(await verdict(validResponse(), { certificates: [WEAK_CERTIFICATE_PEM] })).toBe(
      'no_usable_certificate',
    );
    expect(await verdict(validResponse(), { certificates: [UNPARSEABLE_CERTIFICATE_PEM] })).toBe(
      'no_usable_certificate',
    );
    expect(await verdict(validResponse(), { certificates: [] })).toBe('no_usable_certificate');
  });

  it('skips an unusable certificate and still accepts a usable one', async () => {
    expect(
      await verdict(validResponse(), {
        certificates: [EXPIRED_CERTIFICATE_PEM, IDP_CERTIFICATE],
      }),
    ).toBe('accepted');
  });

  it('refuses SHA-1 signatures and SHA-1 digests as a downgrade', async () => {
    const sha1Signature = sign(buildResponse(), {
      signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    });
    expect(await verdict(sha1Signature)).toBe('weak_algorithm');

    const sha1Digest = sign(buildResponse(), {
      digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    });
    expect(await verdict(sha1Digest)).toBe('weak_algorithm');
  });

  it('refuses comment-preserving canonicalisation', async () => {
    const withComments = sign(buildResponse(), {
      canonicalization: 'http://www.w3.org/2001/10/xml-exc-c14n#WithComments',
    });
    expect(await verdict(withComments)).toBe('weak_algorithm');
  });

  it('refuses more signatures than a SAML response can justify', async () => {
    const once = sign(buildResponse());
    const twice = sign(once, { target: { localName: 'Response', id: '_response-1' } });
    const thrice = sign(twice, {
      target: { localName: 'Assertion', id: '_assertion-1' },
      canonicalization: EXC_C14N,
    });
    expect(await verdict(thrice)).toBe('unsigned');
  });
});

describe('verifySamlResponse — conditions and binding', () => {
  it('refuses an assertion minted for another service provider', async () => {
    const xml = sign(
      buildResponse({ assertions: [buildAssertion({ audience: 'https://other.example/saml' })] }),
    );
    expect(await verdict(xml)).toBe('audience_mismatch');
  });

  it('refuses an assertion with no audience restriction at all', async () => {
    const xml = sign(buildResponse({ assertions: [buildAssertion({ audience: null })] }));
    expect(await verdict(xml)).toBe('audience_mismatch');
  });

  it('refuses a response addressed to a different endpoint', async () => {
    const xml = sign(buildResponse({ destination: 'https://app.nexa.test/auth/saml/conn-2/acs' }));
    expect(await verdict(xml)).toBe('destination_mismatch');
  });

  it('refuses a bearer confirmation addressed to a different endpoint', async () => {
    const xml = sign(
      buildResponse({
        assertions: [buildAssertion({ recipient: 'https://evil.example/acs' })],
      }),
    );
    expect(await verdict(xml)).toBe('recipient_mismatch');
  });

  it('refuses an expired assertion', async () => {
    const xml = validResponse();
    expect(await verdict(xml, {}, memoryGuard(), new Date('2026-08-14T10:30:00Z'))).toBe('expired');
  });

  it('refuses an assertion that is not valid yet', async () => {
    const xml = validResponse();
    expect(await verdict(xml, {}, memoryGuard(), new Date('2026-08-14T09:50:00Z'))).toBe(
      'not_yet_valid',
    );
  });

  it('forgives clock skew on both bounds, and no more', async () => {
    const xml = validResponse();
    const notOnOrAfter = new Date('2026-08-14T10:05:00Z').getTime();
    const notBefore = new Date('2026-08-14T10:00:00Z').getTime();

    expect(await verdict(xml, {}, memoryGuard(), new Date(notOnOrAfter + 60_000))).toBe('accepted');
    expect(
      await verdict(xml, {}, memoryGuard(), new Date(notOnOrAfter + ASSERTION_CLOCK_SKEW_MS)),
    ).toBe('expired');
    expect(await verdict(xml, {}, memoryGuard(), new Date(notBefore - 60_000))).toBe('accepted');
    expect(
      await verdict(xml, {}, memoryGuard(), new Date(notBefore - ASSERTION_CLOCK_SKEW_MS - 1)),
    ).toBe('not_yet_valid');
  });

  it('refuses an assertion with no time bound', async () => {
    const noConditions = sign(
      buildResponse({ assertions: [buildAssertion({ omitConditions: true })] }),
    );
    expect(await verdict(noConditions)).toBe('missing_conditions');

    const noNotOnOrAfter = sign(
      buildResponse({ assertions: [buildAssertion({ notOnOrAfter: null })] }),
    );
    expect(await verdict(noNotOnOrAfter)).toBe('missing_conditions');

    const noSubjectBound = sign(
      buildResponse({ assertions: [buildAssertion({ subjectNotOnOrAfter: null })] }),
    );
    expect(await verdict(noSubjectBound)).toBe('missing_conditions');
  });

  it('refuses an unreadable time bound rather than guessing at it', async () => {
    const xml = sign(buildResponse({ assertions: [buildAssertion({ notOnOrAfter: 'tomorrow' })] }));
    expect(await verdict(xml)).toBe('missing_conditions');
  });

  it('refuses an assertion that would be valid for years', async () => {
    const xml = sign(
      buildResponse({ assertions: [buildAssertion({ notOnOrAfter: '2036-08-14T10:05:00Z' })] }),
    );
    expect(await verdict(xml)).toBe('lifetime_too_long');
  });

  it('takes the earliest of the two deadlines as the expiry', async () => {
    const xml = sign(
      buildResponse({
        assertions: [
          buildAssertion({
            notOnOrAfter: '2026-08-14T10:20:00Z',
            subjectNotOnOrAfter: '2026-08-14T10:05:00Z',
          }),
        ],
      }),
    );
    const result = await verifySamlResponse(encode(xml), expectations(), NOW, memoryGuard());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assertion.expiresAt.toISOString()).toBe('2026-08-14T10:05:00.000Z');
  });

  it('refuses an answer to a different AuthnRequest', async () => {
    expect(await verdict(validResponse(), { inResponseTo: '_req-someone-else' })).toBe(
      'in_response_to_mismatch',
    );
  });

  it('refuses an issuer that is not this connection’s IdP', async () => {
    const xml = sign(
      buildResponse({ assertions: [buildAssertion({ issuer: 'https://evil.example' })] }),
    );
    expect(await verdict(xml)).toBe('issuer_mismatch');
  });

  it('refuses an assertion with no usable bearer subject', async () => {
    const noSubject = sign(buildResponse({ assertions: [buildAssertion({ omitSubject: true })] }));
    expect(await verdict(noSubject)).toBe('subject_missing');

    const holderOfKey = sign(
      buildResponse({
        assertions: [
          buildAssertion({ confirmationMethod: 'urn:oasis:names:tc:SAML:2.0:cm:holder-of-key' }),
        ],
      }),
    );
    expect(await verdict(holderOfKey)).toBe('subject_missing');
  });

  it('refuses a response the IdP itself did not succeed on', async () => {
    const xml = sign(buildResponse({ status: 'urn:oasis:names:tc:SAML:2.0:status:AuthnFailed' }));
    expect(await verdict(xml)).toBe('status_not_success');
  });
});

describe('verifySamlResponse — replay', () => {
  it('accepts an assertion once and refuses the second use', async () => {
    const guard = memoryGuard();
    const xml = validResponse();
    expect(await verdict(xml, {}, guard)).toBe('accepted');
    expect(await verdict(xml, {}, guard)).toBe('replay');
  });

  it('does not spend the replay record on an assertion that fails another check', async () => {
    // Otherwise a stream of near-miss submissions could burn the ids of
    // assertions still in flight — a denial of service against real logins.
    const guard = memoryGuard();
    const wrongAudience = sign(
      buildResponse({ assertions: [buildAssertion({ audience: 'https://other.example' })] }),
    );
    expect(await verdict(wrongAudience, {}, guard)).toBe('audience_mismatch');
    expect(guard.seen.size).toBe(0);

    const badSignature = sign(buildResponse(), {
      privateKey: FOREIGN_PRIVATE_KEY,
      publicCert: FOREIGN_CERTIFICATE,
    });
    expect(await verdict(badSignature, {}, guard)).toBe('invalid_signature');
    expect(guard.seen.size).toBe(0);
  });

  it('lets a guard failure propagate rather than admitting the login', async () => {
    // Redis down must not mean "replay protection off". Unlike the rate limiter,
    // failing open here is an authentication bypass with a known start time.
    const failing: AssertionReplayGuard = {
      claim: () => Promise.reject(new Error('redis unavailable')),
    };
    await expect(
      verifySamlResponse(encode(validResponse()), expectations(), NOW, failing),
    ).rejects.toThrow('redis unavailable');
  });
});

describe('createRedisReplayGuard', () => {
  it('accepts a real ioredis client', () => {
    // A type-level assertion, not a runtime one. `ReplayStore` is structural so
    // the verifier's imports stay free of `ioredis`; this is what keeps that
    // structure honest, and it fails at typecheck here rather than in S11-d when
    // the endpoint tries to hand it the real client.
    const client = null as unknown as Redis;
    const store: ReplayStore = client;
    expect(store).toBe(client);
  });

  function fakeStore(): ReplayStore & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    const keys = new Set<string>();
    return {
      calls,
      set(key, value, px, ttlMs, nx) {
        calls.push([key, value, px, ttlMs, nx]);
        if (keys.has(key)) return Promise.resolve(null);
        keys.add(key);
        return Promise.resolve('OK');
      },
    };
  }

  it('claims an id once, atomically, and scopes the key to the connection', async () => {
    const store = fakeStore();
    const guard = createRedisReplayGuard(store, 'conn-1');
    const expiresAt = new Date(NOW.getTime() + 4 * 60_000);

    expect(await guard.claim('_assertion-1', expiresAt, NOW)).toBe(true);
    expect(await guard.claim('_assertion-1', expiresAt, NOW)).toBe(false);

    const [key, , px, ttl, nx] = store.calls[0]!;
    expect(key).toBe('saml:replay:conn-1:_assertion-1');
    // `SET NX PX` in one round trip: a read-then-write would let two concurrent
    // submissions of the same captured assertion both see "unused".
    expect(px).toBe('PX');
    expect(nx).toBe('NX');
    expect(ttl).toBe(4 * 60_000 + ASSERTION_CLOCK_SKEW_MS);
  });

  it('never asks Redis for a non-positive TTL', async () => {
    const store = fakeStore();
    const guard = createRedisReplayGuard(store, 'conn-1');
    await guard.claim('_old', new Date(NOW.getTime() - 60 * 60_000), NOW);
    expect(store.calls[0]![3]).toBe(1_000);
  });

  it('keys different connections apart', async () => {
    const store = fakeStore();
    expect(await createRedisReplayGuard(store, 'conn-1').claim('_a', NOW, NOW)).toBe(true);
    expect(await createRedisReplayGuard(store, 'conn-2').claim('_a', NOW, NOW)).toBe(true);
  });
});

describe('verifySamlResponse — malformed input', () => {
  it('refuses anything that is not base64', async () => {
    const reasons = await Promise.all(
      ['', '   ', 'not base64!', '<samlp:Response/>'].map(async (value) => {
        const result = await verifySamlResponse(value, expectations(), NOW, memoryGuard());
        return result.ok ? 'accepted' : result.reason;
      }),
    );
    expect(reasons).toEqual([
      'malformed_base64',
      'malformed_base64',
      'malformed_base64',
      'malformed_base64',
    ]);
  });

  it('refuses a payload larger than the ceiling', async () => {
    const padded = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">${'x'.repeat(
      MAX_SAML_RESPONSE_BYTES + 1,
    )}</samlp:Response>`;
    const result = await verifySamlResponse(encode(padded), expectations(), NOW, memoryGuard());
    expect(result.ok ? 'accepted' : result.reason).toBe('too_large');
  });

  it('refuses a document that declares a DTD', async () => {
    // Entity expansion is a budget handed to an unauthenticated caller, and a
    // SAML response has no legitimate use for a DTD.
    const bomb =
      `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]>` +
      buildResponse();
    expect(await verdict(bomb)).toBe('doctype');
  });

  it('refuses malformed XML and non-Response roots', async () => {
    expect(await verdict('<samlp:Response>unclosed')).toBe('malformed_xml');
    expect(await verdict('<html><body>login failed</body></html>')).toBe('not_a_response');
    // The assertion namespace is not the protocol namespace: a bare Assertion
    // posted to the ACS endpoint is not a Response.
    expect(await verdict(buildAssertion())).toBe('not_a_response');
  });

  it('names an encrypted assertion rather than calling it unsigned', async () => {
    const encrypted = buildResponse({ assertions: [] }).replace(
      '</samlp:Response>',
      '<saml:EncryptedAssertion><xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#"/></saml:EncryptedAssertion></samlp:Response>',
    );
    expect(await verdict(encrypted)).toBe('encrypted_assertion');
  });
});
