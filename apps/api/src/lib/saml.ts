/**
 * SAML 2.0 assertion verification (NFR-S11 · S11-b).
 *
 * This module answers exactly one question: *given a base64 SAMLResponse and
 * what we expect of it, may its assertion be believed?* It does not decide who
 * the assertion maps to, does not mint a session and does not touch the
 * database — those are the SP endpoints (S11-d). Pure by construction, like
 * `ip-allowlist.ts` and `sso-connection.ts`: no Prisma, no Fastify, no network.
 * The one piece of state it needs — "has this assertion already been used" — is
 * injected as an {@link AssertionReplayGuard}, so the whole rejection matrix can
 * be tested to exhaustion before any of it guards a real login.
 *
 * ## Why signature, conditions and replay live in one module
 *
 * They are three ends of a single argument, and any version that has some of
 * them accepts a forged login:
 *
 *   - a signature check alone accepts an assertion minted for *another* service
 *     provider, or one that expired last March;
 *   - conditions alone are attacker-authored text;
 *   - both together still accept the same assertion twice, so anything that ever
 *     observes one — a proxy log, a browser history, a shared machine — holds a
 *     reusable credential.
 *
 * ## The XSW rule (the reason this file exists at all)
 *
 * XML Signature Wrapping is what happens when the node whose signature was
 * verified and the node whose contents are read are not the same node. The
 * attacker takes an assertion legitimately signed for *them*, hides it somewhere
 * the verifier will find it (`Extensions`, a wrapper `Response`, a duplicated
 * `ID`), and puts a forged assertion where the reader will look. Both steps
 * succeed, and each is individually "correct".
 *
 * The defence here is structural rather than a list of shapes to reject:
 *
 *   **Nothing is ever read from the parsed document. The claims are read from
 *   the canonical bytes the digest actually covered** — `getSignedReferences()`,
 *   re-parsed into a fresh document. If a node was not signed it does not exist
 *   as far as this module is concerned, whatever it looks like or wherever it
 *   sits. That makes the wrapping variants uninteresting: they all work by
 *   putting something unsigned where a reader looks, and there is no such reader.
 *
 * The one narrow exception is refusal-only reads (`Status`, `Destination`),
 * marked at each site. Those are extra AND-conditions over unsigned bytes: an
 * attacker who controls them can only cause a refusal, never an acceptance, so
 * they cannot be used to get in. **No accept decision may depend on an unsigned
 * byte** — that invariant is the whole of this file's security argument.
 *
 * ## Library choice (§C-A17.3)
 *
 * XML-DSig is not implemented here. Canonicalisation is the part everyone gets
 * wrong, and a bespoke implementation would be the least reviewed security code
 * in the repository. `xml-crypto` (v6, node-saml) does the signature maths and
 * `@xmldom/xmldom` the parsing; this module supplies the SAML profile, the
 * algorithm allow-list and the XSW rule above, which is where the decisions are.
 */
import { X509Certificate } from 'node:crypto';
// The API package has no DOM lib — it is a Node service — so `Document`,
// `Element` and `Node` come from the parser rather than from globals.
import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { inspectIdpCertificate } from './sso-connection.js';

export const SAML_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
export const SAML_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
export const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';

const STATUS_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';
const BEARER_CONFIRMATION = 'urn:oasis:names:tc:SAML:2.0:cm:bearer';

/**
 * How much clock difference between us and the IdP is forgiven on every time
 * bound in the assertion.
 *
 * Deliberately tighter than the five minutes a *certificate* gets in
 * `sso-connection.ts`. A certificate lives for years, so five minutes is
 * rounding error against its lifetime; an assertion lives for minutes, so the
 * same allowance would be a large fraction of the window in which a captured
 * one is still usable. Three minutes covers ordinary NTP drift and no more.
 */
export const ASSERTION_CLOCK_SKEW_MS = 3 * 60_000;

/**
 * The longest future validity an assertion may claim.
 *
 * Real IdPs mint assertions good for a few minutes. Without a ceiling, a
 * misconfigured (or hostile) IdP could issue one valid for a decade: the
 * conditions check would pass it every time, and the replay record that stops
 * the second use would have to be kept for a decade to match. Bounding the
 * credential is the fix; bounding only the replay record would leave a window
 * that opens the moment the record expires.
 */
export const MAX_ASSERTION_LIFETIME_MS = 24 * 60 * 60_000;

/**
 * Ceiling on the decoded XML. A SAML response with a full attribute statement
 * is a few kilobytes; this is three orders of magnitude of headroom and still
 * refuses a payload sized to make canonicalisation the expensive part of an
 * unauthenticated request.
 */
export const MAX_SAML_RESPONSE_BYTES = 512 * 1024;

/**
 * At most a Response signature and an Assertion signature. Anything beyond that
 * is not a shape a SAML IdP produces, and each extra signature is another node
 * an attacker gets to choose the contents of.
 */
const MAX_SIGNATURES = 2;

/**
 * Algorithm allow-lists. Everything absent is refused *by name*, before any
 * verification runs, so a downgrade is a distinct rejection rather than a
 * confusing "invalid signature".
 *
 * SHA-1 is excluded from both the signature and the digest side. Chosen-prefix
 * collisions against SHA-1 are a purchasable service, and a collision in a
 * `DigestValue` is a second document with the same signature — precisely the
 * property the whole scheme rests on. `xml-crypto` still ships rsa-sha1 enabled;
 * this narrows it. (HMAC is already off by default there — with a shared secret
 * the "signature" would prove nothing about *which* party wrote the assertion.)
 *
 * The `#WithComments` canonicalisations are excluded too. They keep comments in
 * the signed bytes, which is the whole mechanism of the SAML comment-injection
 * class (CVE-2017-11427): `admin@corp.example<!---->.evil.example` reads as two
 * text nodes to a careless reader and as one string to the digest. Refusing them
 * means the signed bytes this module re-parses never contain a comment at all.
 */
const ALLOWED_CANONICALIZATION = new Set([
  'http://www.w3.org/2001/10/xml-exc-c14n#',
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
]);
const ALLOWED_SIGNATURE_METHODS = new Set([
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
]);
const ALLOWED_DIGEST_METHODS = new Set([
  'http://www.w3.org/2001/04/xmlenc#sha256',
  'http://www.w3.org/2001/04/xmlenc#sha512',
]);
const ENVELOPED_SIGNATURE_TRANSFORM = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/** Why a SAMLResponse was refused. Every path out of the verifier names one. */
export type SamlRejection =
  /** The `SAMLResponse` form field is not base64. */
  | 'malformed_base64'
  /** Decoded payload over {@link MAX_SAML_RESPONSE_BYTES}. */
  | 'too_large'
  /** Carries a DTD — entity expansion / external entity territory. */
  | 'doctype'
  /** Not well-formed XML. */
  | 'malformed_xml'
  /** Well-formed, but the root is not a `samlp:Response`. */
  | 'not_a_response'
  /** `StatusCode` is not Success — the IdP itself refused the login. */
  | 'status_not_success'
  /** No configured certificate is usable today (expired, weak, unparseable). */
  | 'no_usable_certificate'
  /** No `ds:Signature` at all, or more than {@link MAX_SIGNATURES}. */
  | 'unsigned'
  /** A signature names an algorithm outside the allow-list. */
  | 'weak_algorithm'
  /** A signature does not verify against any usable certificate. */
  | 'invalid_signature'
  /** Only an `EncryptedAssertion` — not supported, and never silently skipped. */
  | 'encrypted_assertion'
  /** The signatures verified, but covered no assertion. The XSW verdict. */
  | 'assertion_missing'
  /** Signed payloads carry assertions with different ids. */
  | 'assertion_ambiguous'
  /** `Issuer` is not the IdP this connection is configured for. */
  | 'issuer_mismatch'
  /** `AudienceRestriction` does not name us. */
  | 'audience_mismatch'
  /** The response is addressed to a different endpoint. */
  | 'destination_mismatch'
  /** The bearer confirmation is addressed to a different endpoint. */
  | 'recipient_mismatch'
  /** `InResponseTo` does not match the request we sent. */
  | 'in_response_to_mismatch'
  /** Unsolicited assertion while `allowIdpInitiated` is off. */
  | 'idp_initiated_not_allowed'
  /** No time bound at all — an assertion that never expires. */
  | 'missing_conditions'
  /** `NotBefore` is still in the future. */
  | 'not_yet_valid'
  /** `NotOnOrAfter` has passed. */
  | 'expired'
  /** Validity window longer than {@link MAX_ASSERTION_LIFETIME_MS}. */
  | 'lifetime_too_long'
  /** No usable bearer `Subject`. */
  | 'subject_missing'
  /** This assertion id has been used before. */
  | 'replay';

/** What the caller must tell us before an assertion can mean anything. */
export interface SamlExpectations {
  /** `sso_connections.idpEntityId` — who the assertion must claim to be from. */
  idpEntityId: string;
  /** Our own entity id, which the `AudienceRestriction` must name. */
  spEntityId: string;
  /** Our ACS endpoint: the `Destination` / bearer `Recipient`. */
  acsUrl: string;
  /**
   * Trusted signing certificates in PEM, most current first. More than one only
   * during a rotation overlap, and the caller is expected to have narrowed the
   * outgoing one through `activePreviousCertificate` — a lapsed overlap must not
   * arrive here at all (§C-A17.1).
   */
  certificates: readonly string[];
  /**
   * The `ID` of the AuthnRequest we sent, or `null` for an unsolicited (IdP-
   * initiated) response.
   */
  inResponseTo: string | null;
  /** `sso_connections.allowIdpInitiated`. */
  allowIdpInitiated: boolean;
}

/** Everything the SP endpoints (S11-d) are allowed to act on. */
export interface VerifiedAssertion {
  /** `Assertion/@ID` — the value the replay guard consumed. */
  assertionId: string;
  issuer: string;
  /** `Subject/NameID` text, or `null` if the assertion carries none. */
  nameId: string | null;
  nameIdFormat: string | null;
  /** `AuthnStatement/@SessionIndex`, for single logout later. */
  sessionIndex: string | null;
  /** `AttributeStatement`, by `Name`. Mapping to fields is S11-d's job. */
  attributes: Record<string, string[]>;
  /** When this assertion stops being valid — the earliest bound that applies. */
  expiresAt: Date;
  /** SHA-256 of the certificate that verified it, for the audit trail. */
  signingCertificateFingerprint: string;
}

export type SamlVerification =
  { ok: true; assertion: VerifiedAssertion } | { ok: false; reason: SamlRejection };

/**
 * The "has this assertion been used already" memory.
 *
 * Injected rather than imported so the verifier stays pure and every replay path
 * is testable without Redis. {@link createRedisReplayGuard} is the production
 * implementation.
 */
export interface AssertionReplayGuard {
  /**
   * Record `assertionId` as used and report whether *this* call is the first.
   *
   * Must be atomic: two browsers submitting the same captured assertion at the
   * same instant have to produce exactly one `true`, or the race is the bypass.
   * `expiresAt` is when the record may be forgotten — by then the conditions
   * check refuses the assertion on its own.
   */
  claim(assertionId: string, expiresAt: Date, now: Date): Promise<boolean>;
}

/**
 * The slice of a Redis client the replay guard uses. Structural on purpose: the
 * verifier's package graph stays free of `ioredis`, and a test can hand it a
 * three-line fake.
 */
export interface ReplayStore {
  set(
    key: string,
    value: string,
    px: 'PX',
    ttlMs: number,
    nx: 'NX',
  ): Promise<string | null | undefined>;
}

/**
 * Redis-backed replay memory, scoped to one connection.
 *
 * `SET NX PX` is one round trip and decides the race in Redis rather than in
 * two of our processes — a read-then-write would let both submissions of a
 * captured assertion see "unused". The key is scoped by connection so one
 * workspace's traffic can neither observe nor exhaust another's, and the value
 * is a timestamp purely so an operator inspecting a key learns something.
 *
 * A Redis outage makes this throw, and the caller must let it: unlike the rate
 * limiter — which fails open because availability beats a perfectly enforced
 * quota — failing open here would mean accepting replays for the duration of the
 * outage, which is an authentication bypass with a known start time.
 */
export function createRedisReplayGuard(store: ReplayStore, scope: string): AssertionReplayGuard {
  return {
    async claim(assertionId, expiresAt, now) {
      const ttlMs = expiresAt.getTime() + ASSERTION_CLOCK_SKEW_MS - now.getTime();
      // A non-positive TTL would make Redis reject the command; an assertion
      // this old is refused by the conditions check long before it gets here, so
      // the floor only keeps a boundary case from turning into an error.
      const ttl = Math.max(1_000, ttlMs);
      const written = await store.set(
        `saml:replay:${scope}:${assertionId}`,
        String(now.getTime()),
        'PX',
        ttl,
        'NX',
      );
      return written != null;
    },
  };
}

/**
 * Verify a SAMLResponse and return the assertion it authenticates.
 *
 * The order of the steps is itself a security decision: the signature is settled
 * before a single claim is read, and the replay record is only spent on an
 * assertion that is valid in every other respect — otherwise a stream of
 * malformed submissions could burn the ids of assertions still in flight.
 */
export async function verifySamlResponse(
  samlResponseBase64: string,
  expected: SamlExpectations,
  now: Date,
  replayGuard: AssertionReplayGuard,
): Promise<SamlVerification> {
  const decoded = decodeSamlResponse(samlResponseBase64);
  if (!decoded.ok) return decoded;
  const xml = decoded.xml;

  // Before parsing, not after: a DTD is processed *by* the parse, so a check
  // that runs on the resulting document has already paid for the attack.
  if (hasDoctype(xml)) return reject('doctype');

  const document = parseXml(xml);
  if (!document) return reject('malformed_xml');

  const root = document.documentElement;
  if (!root || root.namespaceURI !== SAML_PROTOCOL_NS || root.localName !== 'Response') {
    return reject('not_a_response');
  }

  // --- Refusal-only reads. ---------------------------------------------------
  // These two come from the unsigned document. That is sound because they can
  // only add a refusal: an attacker who rewrites them cannot turn a rejected
  // response into an accepted one, and a legitimate response that disagrees with
  // them is one somebody has been editing in transit. Nothing below this point
  // reads the parsed document again.
  const status = findDescendant(root, SAML_PROTOCOL_NS, 'StatusCode');
  if (status && status.getAttribute('Value') !== STATUS_SUCCESS) {
    return reject('status_not_success');
  }
  const destination = root.getAttribute('Destination');
  if (destination && destination !== expected.acsUrl) return reject('destination_mismatch');

  // --- Signature. ------------------------------------------------------------
  const usable = usableCertificates(expected.certificates, now);
  if (usable.length === 0) return reject('no_usable_certificate');

  const signatures = Array.from(root.getElementsByTagNameNS(XMLDSIG_NS, 'Signature'));
  if (signatures.length === 0 || signatures.length > MAX_SIGNATURES) {
    // An unsigned response that carries an EncryptedAssertion is a supported
    // SAML shape we simply do not implement; saying so beats "unsigned", which
    // would send an operator looking for a signature that is in fact there.
    if (findDescendant(root, SAML_ASSERTION_NS, 'EncryptedAssertion')) {
      return reject('encrypted_assertion');
    }
    return reject('unsigned');
  }

  const signedPayloads: string[] = [];
  let fingerprint: string | null = null;
  for (const signature of signatures) {
    if (!algorithmsAllowed(signature)) return reject('weak_algorithm');

    const verified = verifyOneSignature(signature, xml, usable);
    // Every signature in the document must verify — not merely one of them.
    // Accepting a document with one good and one bad signature would let an
    // attacker append a signature over content of their choosing and rely on us
    // having stopped looking.
    if (!verified) return reject('invalid_signature');

    signedPayloads.push(...verified.payloads);
    fingerprint ??= verified.fingerprint;
  }

  // --- Claims, read only from the bytes the digests covered. -----------------
  const assertions = collectSignedAssertions(signedPayloads);
  if (assertions.length === 0) {
    if (signedPayloads.some((payload) => payload.includes('EncryptedAssertion'))) {
      return reject('encrypted_assertion');
    }
    // The signatures were valid and covered something — just not an assertion.
    // This is where every wrapping variant lands: the forged assertion sits in
    // the document, is never read, and the signed content has nothing to offer.
    return reject('assertion_missing');
  }

  const ids = new Set(assertions.map((assertion) => assertion.getAttribute('ID') ?? ''));
  // Signing both the Response and the Assertion is a legitimate IdP setting, and
  // yields the same assertion twice. Two *different* ids is not that.
  if (ids.size > 1) return reject('assertion_ambiguous');
  const assertion = assertions[0]!;

  const assertionId = assertion.getAttribute('ID');
  if (!assertionId) return reject('assertion_missing');

  const issuer = textOf(findChild(assertion, SAML_ASSERTION_NS, 'Issuer'));
  if (issuer !== expected.idpEntityId) return reject('issuer_mismatch');

  const conditions = checkConditions(assertion, expected.spEntityId, now);
  if (!conditions.ok) return conditions;

  const subject = checkSubject(assertion, expected, now);
  if (!subject.ok) return subject;

  // The earliest bound wins: the assertion stops being usable at whichever of
  // the two deadlines arrives first, so that is also when the replay record has
  // done its job.
  const expiresAt = new Date(
    Math.min(conditions.notOnOrAfter.getTime(), subject.notOnOrAfter.getTime()),
  );

  // Last, and only for an otherwise-valid assertion: see the note on the
  // function's ordering above.
  const first = await replayGuard.claim(assertionId, expiresAt, now);
  if (!first) return reject('replay');

  return {
    ok: true,
    assertion: {
      assertionId,
      issuer,
      nameId: subject.nameId,
      nameIdFormat: subject.nameIdFormat,
      sessionIndex: sessionIndexOf(assertion),
      attributes: attributesOf(assertion),
      expiresAt,
      signingCertificateFingerprint: fingerprint ?? '',
    },
  };
}

function reject(reason: SamlRejection): { ok: false; reason: SamlRejection } {
  return { ok: false, reason };
}

/**
 * base64 → XML text, with the size ceiling applied to the *decoded* length.
 *
 * The character check is explicit because `Buffer.from(…, 'base64')` silently
 * skips anything it does not recognise: without it, a payload of prose decodes
 * to a short byte string and fails later as "malformed XML", which is the wrong
 * diagnosis for input that was never base64.
 */
function decodeSamlResponse(
  value: string,
): { ok: true; xml: string } | { ok: false; reason: SamlRejection } {
  const trimmed = value.trim();
  if (trimmed === '' || !/^[A-Za-z0-9+/\r\n=]+$/.test(trimmed)) {
    return reject('malformed_base64');
  }
  // Cheap pre-check on the encoded form: base64 expands by 4/3, so anything this
  // long cannot decode to something within the ceiling, and we refuse it without
  // allocating the buffer.
  if (trimmed.length > MAX_SAML_RESPONSE_BYTES * 2) return reject('too_large');

  const buffer = Buffer.from(trimmed, 'base64');
  if (buffer.length === 0) return reject('malformed_base64');
  if (buffer.length > MAX_SAML_RESPONSE_BYTES) return reject('too_large');

  return { ok: true, xml: buffer.toString('utf8') };
}

/**
 * Whether the document declares a DTD.
 *
 * `@xmldom/xmldom` does not fetch external entities, so this is not the last
 * line of defence — but an internal subset is still an entity-expansion budget
 * (`billion laughs`) handed to an unauthenticated caller, and a SAML response
 * has no legitimate use for a DTD at all. Refusing the whole class is cheaper
 * to reason about than bounding it.
 */
function hasDoctype(xml: string): boolean {
  return /<!DOCTYPE/i.test(xml);
}

function parseXml(xml: string): Document | null {
  try {
    // `onError` swallows the recoverable warnings xmldom reports through a
    // handler; genuinely malformed input still throws, and both end up as the
    // same `null`.
    const parser = new DOMParser({ onError: () => undefined });
    const document = parser.parseFromString(xml, 'text/xml');
    return document.documentElement ? document : null;
  } catch {
    return null;
  }
}

/**
 * The configured certificates that can verify something *right now*, in the
 * order given.
 *
 * Re-uses `inspectIdpCertificate`, the same rule the write surface applies, so
 * "what counts as a certificate" has one definition in the feature. Running it
 * again at use time is not redundant: a rotation overlap may keep an outgoing
 * certificate trusted for up to seven days (§C-A17.1), and a certificate can
 * expire inside that window — the write-time check cannot know that, and this is
 * the open question S11-a2 left for this window.
 */
function usableCertificates(
  certificates: readonly string[],
  now: Date,
): { pem: string; fingerprint: string }[] {
  const usable: { pem: string; fingerprint: string }[] = [];
  for (const pem of certificates) {
    const inspection = inspectIdpCertificate(pem, now);
    if (inspection.ok) usable.push({ pem, fingerprint: inspection.facts.fingerprint });
  }
  return usable;
}

/**
 * Whether every algorithm this signature names is on the allow-list.
 *
 * Checked by name before any verification runs, so a downgrade attempt is
 * refused as a downgrade. The transform list is checked too: a `Reference` may
 * name transforms beyond the enveloped-signature one, and each is another chance
 * to change what the digest actually covers.
 */
function algorithmsAllowed(signature: Element): boolean {
  const signedInfo = findChild(signature, XMLDSIG_NS, 'SignedInfo');
  if (!signedInfo) return false;

  const canonicalization = findChild(signedInfo, XMLDSIG_NS, 'CanonicalizationMethod');
  if (
    !canonicalization ||
    !ALLOWED_CANONICALIZATION.has(canonicalization.getAttribute('Algorithm') ?? '')
  ) {
    return false;
  }

  const method = findChild(signedInfo, XMLDSIG_NS, 'SignatureMethod');
  if (!method || !ALLOWED_SIGNATURE_METHODS.has(method.getAttribute('Algorithm') ?? '')) {
    return false;
  }

  const references = childrenOf(signedInfo, XMLDSIG_NS, 'Reference');
  if (references.length === 0) return false;

  for (const reference of references) {
    const digest = findChild(reference, XMLDSIG_NS, 'DigestMethod');
    if (!digest || !ALLOWED_DIGEST_METHODS.has(digest.getAttribute('Algorithm') ?? ''))
      return false;

    const transforms = findChild(reference, XMLDSIG_NS, 'Transforms');
    for (const transform of transforms ? childrenOf(transforms, XMLDSIG_NS, 'Transform') : []) {
      const algorithm = transform.getAttribute('Algorithm') ?? '';
      if (algorithm !== ENVELOPED_SIGNATURE_TRANSFORM && !ALLOWED_CANONICALIZATION.has(algorithm)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Verify one signature against the trusted certificates and hand back the exact
 * bytes it covered.
 *
 * The key comes from our stored certificate and from nowhere else: the
 * `publicCert` is set explicitly and `getCertFromKeyInfo` is pinned to `null`,
 * so the `KeyInfo` the *attacker* controls can never become the verification
 * key. (`xml-crypto` v6 already defaults that way; pinning it means a future
 * default cannot quietly turn "signed by our IdP" into "signed by whoever
 * embedded a certificate".)
 *
 * `getSignedReferences()` is the return value that matters — the canonical XML
 * of each validated reference, and the only thing above this line that anyone is
 * allowed to read. `getValidatedNode()` is deprecated as insecure precisely
 * because it re-queries the original document, which is the XSW hole itself.
 */
function verifyOneSignature(
  signature: Element,
  xml: string,
  certificates: { pem: string; fingerprint: string }[],
): { payloads: string[]; fingerprint: string } | null {
  for (const certificate of certificates) {
    let publicKey;
    try {
      // The public key, not the certificate: `xml-crypto` would accept either,
      // but extracting it here means the certificate is parsed exactly once, by
      // the same code that just judged it usable.
      publicKey = new X509Certificate(certificate.pem).publicKey;
    } catch {
      continue;
    }

    const verifier = new SignedXml({ publicCert: publicKey, getCertFromKeyInfo: () => null });
    // Defence in depth behind `algorithmsAllowed`: even if a downgrade slipped
    // past the name check, the algorithm is not registered and verification
    // cannot fall back to it.
    verifier.SignatureAlgorithms = pick(verifier.SignatureAlgorithms, ALLOWED_SIGNATURE_METHODS);
    verifier.HashAlgorithms = pick(verifier.HashAlgorithms, ALLOWED_DIGEST_METHODS);
    verifier.CanonicalizationAlgorithms = pick(
      verifier.CanonicalizationAlgorithms,
      new Set([...ALLOWED_CANONICALIZATION, ENVELOPED_SIGNATURE_TRANSFORM]),
    );

    try {
      verifier.loadSignature(signature as unknown as Node);
      // Throws on the shapes it refuses outright — notably two elements sharing
      // one `ID`, which is a wrapping attempt and not a difference of opinion.
      if (!verifier.checkSignature(xml)) continue;
    } catch {
      continue;
    }

    const payloads = verifier.getSignedReferences();
    if (payloads.length === 0) continue;
    return { payloads, fingerprint: certificate.fingerprint };
  }

  return null;
}

function pick<T>(registry: Record<string, T>, allowed: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(registry).filter(([name]) => allowed.has(name)));
}

/**
 * The assertions inside the signed bytes — the only assertions that exist.
 *
 * Each payload is re-parsed on its own. A signed `Response` yields the assertion
 * nested inside it; a signed `Assertion` *is* the payload. Anything that fails
 * to parse is dropped rather than guessed at.
 */
function collectSignedAssertions(payloads: string[]): Element[] {
  const assertions: Element[] = [];
  for (const payload of payloads) {
    const document = parseXml(payload);
    const root = document?.documentElement;
    if (!root) continue;

    if (root.namespaceURI === SAML_ASSERTION_NS && root.localName === 'Assertion') {
      assertions.push(root);
      continue;
    }
    assertions.push(...Array.from(root.getElementsByTagNameNS(SAML_ASSERTION_NS, 'Assertion')));
  }
  return assertions;
}

/**
 * `Conditions`: is this assertion valid now, is it valid *for us*, and does it
 * claim a sane lifetime.
 *
 * A `NotOnOrAfter` is required rather than optional. The spec allows an
 * assertion with no time bound; accepting one would mean minting a credential
 * that never stops working, and the replay guard could not clean up after it
 * because there would be no moment at which it stopped mattering.
 */
function checkConditions(
  assertion: Element,
  spEntityId: string,
  now: Date,
): { ok: true; notOnOrAfter: Date } | { ok: false; reason: SamlRejection } {
  const conditions = findChild(assertion, SAML_ASSERTION_NS, 'Conditions');
  if (!conditions) return reject('missing_conditions');

  const notOnOrAfter = parseInstant(conditions.getAttribute('NotOnOrAfter'));
  if (!notOnOrAfter) return reject('missing_conditions');
  if (now.getTime() >= notOnOrAfter.getTime() + ASSERTION_CLOCK_SKEW_MS) return reject('expired');
  if (notOnOrAfter.getTime() - now.getTime() > MAX_ASSERTION_LIFETIME_MS) {
    return reject('lifetime_too_long');
  }

  const notBefore = parseInstant(conditions.getAttribute('NotBefore'));
  if (notBefore && now.getTime() < notBefore.getTime() - ASSERTION_CLOCK_SKEW_MS) {
    return reject('not_yet_valid');
  }

  // Several `AudienceRestriction` elements are an AND (every one must be
  // satisfied); several `Audience` children inside one are an OR. Getting this
  // backwards would accept an assertion minted for somebody else that happens to
  // also mention us.
  const restrictions = childrenOf(conditions, SAML_ASSERTION_NS, 'AudienceRestriction');
  if (restrictions.length === 0) return reject('audience_mismatch');
  for (const restriction of restrictions) {
    const audiences = childrenOf(restriction, SAML_ASSERTION_NS, 'Audience').map((element) =>
      textOf(element),
    );
    if (!audiences.includes(spEntityId)) return reject('audience_mismatch');
  }

  return { ok: true, notOnOrAfter };
}

interface SubjectCheck {
  ok: true;
  nameId: string | null;
  nameIdFormat: string | null;
  notOnOrAfter: Date;
}

/**
 * The bearer `Subject`: who the assertion is about, and the confirmation data
 * that binds it to *this* exchange.
 *
 * `Recipient` and `InResponseTo` are checked here rather than on the `Response`
 * element on purpose. Those attributes exist in both places, but only the ones
 * inside the assertion are inside the signature when an IdP signs the assertion
 * alone — the common configuration. Reading them from the assertion means the
 * binding is checked against bytes the IdP actually stood behind.
 */
function checkSubject(
  assertion: Element,
  expected: SamlExpectations,
  now: Date,
): SubjectCheck | { ok: false; reason: SamlRejection } {
  const subject = findChild(assertion, SAML_ASSERTION_NS, 'Subject');
  if (!subject) return reject('subject_missing');

  const confirmations = childrenOf(subject, SAML_ASSERTION_NS, 'SubjectConfirmation').filter(
    (element) => element.getAttribute('Method') === BEARER_CONFIRMATION,
  );
  if (confirmations.length === 0) return reject('subject_missing');

  // Any one bearer confirmation may satisfy the binding, so the *reason* the
  // last one failed is the one worth reporting; a document with a single
  // confirmation — every real one — reports exactly its own failure.
  let failure: SamlRejection = 'subject_missing';
  for (const confirmation of confirmations) {
    const data = findChild(confirmation, SAML_ASSERTION_NS, 'SubjectConfirmationData');
    if (!data) {
      failure = 'subject_missing';
      continue;
    }

    const recipient = data.getAttribute('Recipient');
    if (recipient !== expected.acsUrl) {
      failure = 'recipient_mismatch';
      continue;
    }

    const inResponseTo = data.getAttribute('InResponseTo');
    if (expected.inResponseTo === null) {
      // Unsolicited. Refused unless the workspace turned it on, and refused even
      // then if the assertion answers a request — that request was not ours.
      if (!expected.allowIdpInitiated) {
        failure = 'idp_initiated_not_allowed';
        continue;
      }
      if (inResponseTo) {
        failure = 'in_response_to_mismatch';
        continue;
      }
    } else if (inResponseTo !== expected.inResponseTo) {
      failure = 'in_response_to_mismatch';
      continue;
    }

    // Required by the Web Browser SSO profile, and required here for the same
    // reason `Conditions/@NotOnOrAfter` is: it bounds how long a captured
    // assertion is worth anything.
    const notOnOrAfter = parseInstant(data.getAttribute('NotOnOrAfter'));
    if (!notOnOrAfter) {
      failure = 'missing_conditions';
      continue;
    }
    if (now.getTime() >= notOnOrAfter.getTime() + ASSERTION_CLOCK_SKEW_MS) {
      failure = 'expired';
      continue;
    }

    const nameIdElement = findChild(subject, SAML_ASSERTION_NS, 'NameID');
    return {
      ok: true,
      nameId: nameIdElement ? textOf(nameIdElement) || null : null,
      nameIdFormat: nameIdElement?.getAttribute('Format') || null,
      notOnOrAfter,
    };
  }

  return reject(failure);
}

function sessionIndexOf(assertion: Element): string | null {
  const statement = findChild(assertion, SAML_ASSERTION_NS, 'AuthnStatement');
  return statement?.getAttribute('SessionIndex') || null;
}

/**
 * `AttributeStatement` as `Name → values`. Left raw: which attribute is the
 * email address is the connection's `attributeMapping`, and applying it is
 * S11-d's decision, not this module's.
 */
function attributesOf(assertion: Element): Record<string, string[]> {
  const attributes: Record<string, string[]> = {};
  for (const statement of childrenOf(assertion, SAML_ASSERTION_NS, 'AttributeStatement')) {
    for (const attribute of childrenOf(statement, SAML_ASSERTION_NS, 'Attribute')) {
      const name = attribute.getAttribute('Name');
      if (!name) continue;
      const values = childrenOf(attribute, SAML_ASSERTION_NS, 'AttributeValue').map((element) =>
        textOf(element),
      );
      // A repeated `Name` extends the list rather than replacing it: dropping
      // the earlier values would silently lose a group membership.
      attributes[name] = [...(attributes[name] ?? []), ...values];
    }
  }
  return attributes;
}

/**
 * An `xs:dateTime` from the document, or `null` if it is not one.
 *
 * `Date.parse` accepts a lot that `xs:dateTime` does not, so the shape is
 * pinned first: a bound we cannot read exactly is not a bound, and guessing at
 * one would be guessing at when a credential expires.
 */
function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// --- DOM helpers. ------------------------------------------------------------
// Namespace-aware and explicit rather than XPath strings: the queries are fixed
// at compile time, so there is no expression for a document to influence.

function childrenOf(parent: Element, namespace: string, localName: string): Element[] {
  const matches: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.namespaceURI === namespace && element.localName === localName)
      matches.push(element);
  }
  return matches;
}

function findChild(parent: Element | null, namespace: string, localName: string): Element | null {
  return parent ? (childrenOf(parent, namespace, localName)[0] ?? null) : null;
}

function findDescendant(root: Element, namespace: string, localName: string): Element | null {
  return root.getElementsByTagNameNS(namespace, localName)[0] ?? null;
}

/**
 * The element's text, gathered across *every* descendant text node.
 *
 * The concatenation is the point. Reading only the first child is the reader
 * half of the SAML comment-injection bug (CVE-2017-11427): a comment splits one
 * logical string into two text nodes, the digest sees the whole thing and the
 * careless reader sees the prefix. Refusing `#WithComments` canonicalisation
 * already means signed bytes reach us comment-free; this makes the reader safe
 * on its own terms rather than by relying on that.
 */
function textOf(element: Element | null): string {
  if (!element) return '';
  let text = '';
  const visit = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3 || child.nodeType === 4) text += child.nodeValue ?? '';
      else if (child.nodeType === 1) visit(child);
    }
  };
  visit(element);
  return text.trim();
}
