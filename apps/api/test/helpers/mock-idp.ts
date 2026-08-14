/**
 * Mock IdP harness (NFR-S11 · S11-c).
 *
 * A minimal stand-in for a SAML 2.0 identity provider, for tests that need a
 * *believable* signed assertion rather than a fabricated one. `verifySamlResponse`
 * (`saml.ts`, S11-b) reads every claim from the bytes its signature actually
 * covered, never from the parsed document — a test double that skipped the
 * crypto would not be exercising that code path at all.
 *
 * Scope is deliberately narrow: {@link issueAssertion} only ever produces the
 * happy path. Malformed, expired, replayed and signature-wrapped (XSW) variants
 * are attack modelling and stay with the verifier they attack — see
 * `src/lib/saml.test.ts` (S11-b), which owns the rejection matrix and, until
 * this file existed, this same key pair. This module exists so the SP endpoints
 * (S11-d) and later integration/e2e suites can obtain a valid login without
 * duplicating the XML-signing machinery.
 */
import { SignedXml } from 'xml-crypto';

/**
 * NOT A SECRET. A throwaway RSA-2048 pair generated for this repository with
 * `openssl req -x509`, standing in for the IdP's signing key. Promoted from
 * `saml.test.ts` (S11-b), which minted it first and did not wait for this file
 * to land — the codebase has exactly one mock IdP key pair, not two. The
 * validity window is pinned (2025 → 2125) so the fixtures cannot rot.
 */
export const MOCK_IDP_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCocZGUQNemmnVm
+VTYIWCfWrtege16oOYkoYwMyTA2QnawHA8jdlDMYiDi9XFA0tgPxswj+Wd4asAc
PGfE5MysylaR82lkLvyQvM22xwzJTmgEPTUuabOPHha9TMPG939mz7uTN0uCgYn/
nh0admuInsfXuICJLO5CO03lQHOgG/n0PXp5Acqtetr5LH3wt6QDXfhDyBKttxsv
D22hlrImdwadZO9Tfapf3IbQ49G/2FJoIY2b333k1LO4bRlICAWUvcCAE11GdqYu
FX1THVchoUmGlKZgGcT6Z2matvfaWlpPk+ek8rp+5k8WEWBNelrmMSUnRNuNQ0N2
gh0VwS1lAgMBAAECggEADEoY6n2enj+nsCchyxEIWSgIApmtJ2TE1chZjPdCxrqr
qSaq7hXsSDUinBx3MlkPvXruGvPP2kfDk2vO0F03F6Y9kbF2L4KEF9VGlv7Hzooj
aafDkQrSOG9kDlSi9gnJqEkgsNl4b2GfHWC+U9du+g1HnFQQQLHgAkIMaVz98qDp
WHwNfN83kyzJtmBEMI2dJgRUjzfsaqmHh2292Z6ajMKKEWm2csUDvey0DS0UAAbN
E3q53ZntFRvm+8ppQCcU6QWJe1c5wFYqzmLcuJIKej8xF0fnQ6heigEQzNOzg6FL
aOIJ2XFMmaTzsX3jRLakf+UdqR7/H4CFJ2YPPngmkwKBgQDssklDHxKRgBjHLLTC
AnsIE3iN1eVw/7BnaojVSuRNbnc7i7NAMhR87EjHA9FkKNdB2RXZ8gImwua6S0vz
8m6Udvr9yZNlhV9ZEGZ0VtmHw+KOiaMNYaG8iQ11D4jxf9HDbu3jqSCyiS4lc9u4
6wH7LCHuA5coM6kk0kp1WGH1ZwKBgQC2Lk9zBntdxwXH7Je4dc9MDIOl75zjjkew
bHcbcCFz0wFUDY52YSAD098G/RA5OPIRbVpi/Qy2kK1frT+2/FS4ZhiBFGyU3PZ5
SIiB72a9+ib0QA5YlR9Vfj+0WvecOGKuXzgWDeitFEmqWJaS0er21y3ImBC8ZfZH
qD+LcUVbUwKBgHn9lVa7wAUvgRW+S9cmEiTibCKl2B/6F//k32sWsz3ZLiiJYrQ2
W2rbGNNBe3zks7SjXui6GzPBBcuEHTw4eZeZDtkYOBh9uducYUGatXiMk8qk012F
MSeLd10ayZi2KPVRydepBkod+6Of5+GRda7vWvlh7ljw7z8kBu4dxDcHAoGAIGmk
4QYqNMkQEj3Z0IvFUfZ4BbHX6/SIdK8Xkd4lVYIZHmc7DXzCQWwUph2oIUYsa0VV
a38yH9klv3wHdfr258fiXDTSDLozb+ijwNpjITG8dIBhDQmbBY7srp3wp+6wP+3Z
ALOAzipp4NDaGU0XzMsD7kh/0cUiSCV7CMgiWtkCgYBUqwWQJo5pNi8aUNgV55BW
eAmsWFpCXmoUHNQ7YK0H8gdfs/xkPBxCNxCGBMxCoBrbjXM6a5ilxyc1ZFfmaA1C
CeLKyHTcmK3fnXacZl1+Q33unqz5kdgkclBvaxT/DzVSfFU8o/VyJaNFuBf7FQy3
cgYCZln7/ruFRsBCcZ9AGA==
-----END PRIVATE KEY-----
`;

/** The public half of {@link MOCK_IDP_PRIVATE_KEY}, `CN=idp-signing.example.test`. */
export const MOCK_IDP_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDKTCCAhGgAwIBAgIUfOobKUggNrTnuMOd33JsVP/W61YwDQYJKoZIhvcNAQEL
BQAwIzEhMB8GA1UEAwwYaWRwLXNpZ25pbmcuZXhhbXBsZS50ZXN0MCAXDTI1MDEw
MTAwMDAwMFoYDzIxMjUwMTAxMDAwMDAwWjAjMSEwHwYDVQQDDBhpZHAtc2lnbmlu
Zy5leGFtcGxlLnRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCo
cZGUQNemmnVm+VTYIWCfWrtege16oOYkoYwMyTA2QnawHA8jdlDMYiDi9XFA0tgP
xswj+Wd4asAcPGfE5MysylaR82lkLvyQvM22xwzJTmgEPTUuabOPHha9TMPG939m
z7uTN0uCgYn/nh0admuInsfXuICJLO5CO03lQHOgG/n0PXp5Acqtetr5LH3wt6QD
XfhDyBKttxsvD22hlrImdwadZO9Tfapf3IbQ49G/2FJoIY2b333k1LO4bRlICAWU
vcCAE11GdqYuFX1THVchoUmGlKZgGcT6Z2matvfaWlpPk+ek8rp+5k8WEWBNelrm
MSUnRNuNQ0N2gh0VwS1lAgMBAAGjUzBRMB0GA1UdDgQWBBTQbWUY2uhEsiaQvrSQ
JIrgbCGXADAfBgNVHSMEGDAWgBTQbWUY2uhEsiaQvrSQJIrgbCGXADAPBgNVHRMB
Af8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQCkDudT3tFkqZajVbJEyxVBoXTu
qkbQEJrb91ekw4qW/+q1sPU2BeAa5HOYzUZ++gUoaDhNbSb70xOHfn/Me6yvD39J
S75rUJ3wihD4aEcTr2sVIV/S8e1q3PMI17hDqyeM5jVkBintSijgIC8RvARjjoHs
UF7NLfxoO3bnb5oUjSdtUrQsCDU9yIuFPahiWgCX1SQlf2G+Uc2gmQn83pyZE2oU
MVdTwEP52xe53WQNasgPie1JcaktkSFPldELctvUXRVMu41rdshFH06RUvv/io1c
F9K3pw3ol8gtt9OZcl2BezqA/f4VjZTITfBmFg+ep71Xmnt6NU/hnGg3b0cp
-----END CERTIFICATE-----
`;

/** `Issuer` on every assertion this harness signs. */
export const MOCK_IDP_ENTITY_ID = 'https://idp-signing.example.test/metadata';

/** Default `audience` — matches `saml.test.ts`'s stand-in for Nexa's own entity id. */
export const MOCK_SP_ENTITY_ID = 'https://app.nexa.test/saml/metadata';

/**
 * Default `destination`. A real caller wiring up an `sso_connections` row has
 * an actual per-connection ACS URL (`/auth/saml/{id}/acs`, S11-d) and should
 * pass it as `destination` instead — this default only serves calls that just
 * want *a* valid assertion, such as this file's own unit test.
 */
export const MOCK_ACS_URL = 'https://app.nexa.test/auth/saml/mock-connection/acs';

const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED_SIGNATURE = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

/** Distinguishes assertions issued within one test run — never reused as a secret. */
let issuedCount = 0;

export interface IssueAssertionOptions {
  /** `Subject/NameID` — the identity the assertion vouches for. */
  subject?: string;
  /** `AttributeStatement`, by name. Defaults to a single `email` equal to `subject`. */
  attributes?: Record<string, string[]>;
  /** `AudienceRestriction/Audience` — the SP entity id the assertion is minted for. */
  audience?: string;
  /** `Response/@Destination` and the bearer `Recipient` — the ACS URL it targets. */
  destination?: string;
  /** Bearer `InResponseTo`, or `null` for an IdP-initiated (unsolicited) login. */
  inResponseTo?: string | null;
  /** `Conditions/@NotOnOrAfter` and the bearer `NotOnOrAfter`. Defaults to five minutes out. */
  notOnOrAfter?: Date;
}

export interface IssuedAssertion {
  /** Ready for `verifySamlResponse`'s `samlResponseBase64` argument. */
  samlResponseBase64: string;
  /** The decoded `samlp:Response` XML, for tests that want to inspect it directly. */
  xml: string;
  /** `Assertion/@ID`, unique per call within this process. */
  assertionId: string;
}

/**
 * Sign and base64-encode one happy-path SAMLResponse, as `MOCK_IDP_ENTITY_ID`
 * would send it to a Nexa ACS endpoint.
 *
 * Signs the `Assertion` only, not the enclosing `Response` — the shape most
 * real IdPs emit, and the one `saml.test.ts` calls `validResponse()`.
 */
export function issueAssertion(options: IssueAssertionOptions = {}): IssuedAssertion {
  const now = new Date();
  const {
    subject = 'agent@corp.example.test',
    attributes = { email: [subject] },
    audience = MOCK_SP_ENTITY_ID,
    destination = MOCK_ACS_URL,
    inResponseTo = null,
    notOnOrAfter = new Date(now.getTime() + 5 * 60_000),
  } = options;

  issuedCount += 1;
  const assertionId = `_mock-assertion-${issuedCount}`;
  const responseId = `_mock-response-${issuedCount}`;
  const sessionIndex = `_mock-session-${issuedCount}`;
  const issueInstant = now.toISOString();
  // A minute of headroom so a slow test runner never lands before `NotBefore`.
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const notOnOrAfterIso = notOnOrAfter.toISOString();

  const attributeStatement = `<saml:AttributeStatement>${Object.entries(attributes)
    .map(
      ([name, values]) =>
        `<saml:Attribute Name="${name}">${values
          .map((value) => `<saml:AttributeValue>${value}</saml:AttributeValue>`)
          .join('')}</saml:Attribute>`,
    )
    .join('')}</saml:AttributeStatement>`;

  const confirmationAttributes = [
    inResponseTo === null ? '' : ` InResponseTo="${inResponseTo}"`,
    ` NotOnOrAfter="${notOnOrAfterIso}"`,
    ` Recipient="${destination}"`,
  ].join('');

  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${issueInstant}">` +
    `<saml:Issuer>${MOCK_IDP_ENTITY_ID}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${subject}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData${confirmationAttributes}/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfterIso}">` +
    `<saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${issueInstant}" SessionIndex="${sessionIndex}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    attributeStatement +
    `</saml:Assertion>`;

  const response =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${destination}">` +
    `<saml:Issuer>${MOCK_IDP_ENTITY_ID}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    assertion +
    `</samlp:Response>`;

  const signed = signAssertion(response, assertionId);

  return {
    samlResponseBase64: Buffer.from(signed, 'utf8').toString('base64'),
    xml: signed,
    assertionId,
  };
}

/**
 * Sign the `Assertion` element in place and return the resulting document.
 *
 * No `KeyInfo` is emitted (`getKeyInfoContent` returns `null`): `saml.ts` never
 * trusts an embedded one (`getCertFromKeyInfo` is pinned to `null` there too),
 * so producing one here would only mislead a reader of the fixture.
 */
function signAssertion(xml: string, assertionId: string): string {
  const selector = `//*[local-name(.)='Assertion' and @ID='${assertionId}']`;
  const signer = new SignedXml({
    privateKey: MOCK_IDP_PRIVATE_KEY,
    publicCert: MOCK_IDP_CERTIFICATE,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
  });
  signer.getKeyInfoContent = () => null;
  signer.addReference({
    xpath: selector,
    transforms: [ENVELOPED_SIGNATURE, EXC_C14N],
    digestAlgorithm: SHA256,
  });
  signer.computeSignature(xml, {
    location: { reference: `${selector}/*[local-name(.)='Issuer']`, action: 'after' },
  });
  return signer.getSignedXml();
}
