/**
 * What may be written into an SSO connection (NFR-S11 · S11-a2).
 *
 * The write surface this backs is the most dangerous one in the feature. An
 * actor who can set `idp_certificate_pem` chooses the key that assertions are
 * verified against, and can therefore mint a signed assertion for anybody in
 * that workspace — full account takeover, in one field. So the rules about what
 * a certificate and an SSO URL may be live here, in a pure module with no
 * database and no Fastify, testable to exhaustion before any of it guards a
 * real request. The route above decides *who* may write; this decides *what*.
 *
 * The same shape as `ip-allowlist.ts`, and for the same reason.
 *
 * Deliberately NOT reusing `ssrf.ts`. That guard answers "may the server fetch
 * this URL", and it refuses loopback and private hosts because a server-side
 * fetch of those reaches internal services. The SSO URL is never fetched by us —
 * it is handed to the *browser* as a redirect target — so the threat is
 * different (scheme injection, credential leakage), and loopback is something we
 * must be able to allow: the mock IdP harness (S11-c) runs on 127.0.0.1.
 */
import { X509Certificate } from 'node:crypto';
import { SSO_ATTRIBUTE_MAPPING_KEYS, type SsoAttributeMapping } from '@nexa/types';

/**
 * Below this an RSA modulus is within reach of a well-resourced attacker, and a
 * forged signature here is a forged *identity*. 1024-bit RSA has been refused by
 * public CAs for over a decade; an IdP still publishing one is misconfigured, not
 * unlucky. Applied to RSA and DSA, where "how many bits" is comparable; EC keys
 * are left alone, since every curve OpenSSL will parse here clears this bar.
 */
export const MIN_RSA_MODULUS_BITS = 2048;

/**
 * EC curves a signing certificate may use. Node reports a certificate's curve by
 * its ASN.1 name (`asymmetricKeyDetails.namedCurve`), not its NIST label, so this
 * is `prime256v1`/`secp384r1`/`secp521r1` — P-256, P-384 and P-521 — the curves at
 * or above the security level {@link MIN_RSA_MODULUS_BITS} draws for RSA. Anything
 * smaller (P-192, P-224, and the non-NIST curves OpenSSL will still parse) is a
 * forgeable trust anchor for the same reason a 1024-bit RSA key is.
 */
export const ALLOWED_EC_CURVES = new Set(['prime256v1', 'secp384r1', 'secp521r1']);

/**
 * How much clock skew a not-yet-valid certificate is forgiven. An IdP that mints
 * a certificate and publishes it in the same minute would otherwise be rejected
 * by a host whose clock runs a little slow — a confusing failure with no security
 * value. Five minutes is the same order as the skew allowance an assertion's
 * `NotBefore` will get (S11-b).
 */
export const CERTIFICATE_NOT_BEFORE_GRACE_MS = 5 * 60_000;

/** Longest overlap a rotation may keep the outgoing certificate trusted for. */
export const MAX_CERTIFICATE_OVERLAP_HOURS = 168; // 7 days

/**
 * How many domains one connection may claim, and how long each may be.
 *
 * Twenty is generous for a real federation (one company, its acquisitions and
 * its regional suffixes) and small enough that the list stays something an
 * owner reads rather than scrolls. 253 is the DNS ceiling for a full name.
 * Both are mirrored by the storage CHECK, so no path can leave behind a longer
 * one — see the migration.
 */
export const MAX_VERIFIED_DOMAINS = 20;
export const SSO_VERIFIED_DOMAIN_MAX_LENGTH = 253;

/** Bounds that keep a single field from becoming a storage or display problem. */
export const SSO_NAME_MAX_LENGTH = 100;
export const SSO_ENTITY_ID_MAX_LENGTH = 1024;
export const SSO_URL_MAX_LENGTH = 2048;
/** A 4096-bit certificate is ~2 KB of PEM; this leaves generous headroom. */
export const SSO_CERTIFICATE_MAX_LENGTH = 16_384;

const CERTIFICATE_BEGIN = /-----BEGIN CERTIFICATE-----/g;

export type CertificateRejection =
  /** Not a certificate at all, or not one OpenSSL will parse. */
  | 'unparseable'
  /** More than one certificate block — see `inspectIdpCertificate`. */
  | 'multiple'
  /** `notAfter` is in the past: it can never verify anything again. */
  | 'expired'
  /** `notBefore` is in the future beyond the skew grace. */
  | 'not_yet_valid'
  /** RSA/DSA key below {@link MIN_RSA_MODULUS_BITS}. */
  | 'weak_key'
  /** EC key on a curve outside {@link ALLOWED_EC_CURVES}. */
  | 'weak_curve';

/**
 * The parts of a certificate worth recording. `fingerprint` is the SHA-256 of
 * the DER, colon-separated — what an IdP console shows next to the certificate,
 * so an audit entry naming it can be matched against the other side by eye. It
 * is a digest of public bytes, which is why it is the one certificate-derived
 * value that may go into the audit trail.
 */
export interface CertificateFacts {
  subject: string;
  fingerprint: string;
  validFrom: Date;
  validTo: Date;
}

export type CertificateInspection =
  { ok: true; facts: CertificateFacts } | { ok: false; reason: CertificateRejection };

/**
 * Decide whether a PEM may be stored as a connection's trust anchor.
 *
 * Exactly one certificate, not a chain. A pasted bundle would parse as its first
 * block, so the workspace would see two certificates in the field and the
 * verifier would honour one — the kind of gap where an operator believes they
 * rotated and did not. Trusting two certificates at once is a real need, and it
 * has a real mechanism (the rotation overlap); silently ignoring the second half
 * of a paste is not it.
 */
export function inspectIdpCertificate(pem: string, now: Date): CertificateInspection {
  CERTIFICATE_BEGIN.lastIndex = 0;
  const blocks = pem.match(CERTIFICATE_BEGIN)?.length ?? 0;
  if (blocks > 1) return { ok: false, reason: 'multiple' };

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(pem);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  const validFrom = certificate.validFromDate;
  const validTo = certificate.validToDate;
  // Undefined would mean a certificate whose validity cannot be read; treating
  // that as parseable would let an unbounded trust anchor through the one check
  // that expires it.
  if (!validFrom || !validTo) return { ok: false, reason: 'unparseable' };

  // Expiry and validity-start are not symmetric on purpose. An expired
  // certificate can never verify another assertion, so storing it configures a
  // connection that is already broken. A not-yet-valid one is refused too — it
  // cannot verify the *next* assertion either, which is what this field is for —
  // but with a skew grace, because "valid as of a few seconds ago" is an ordinary
  // clock difference rather than a misconfiguration.
  if (validTo.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (validFrom.getTime() - CERTIFICATE_NOT_BEFORE_GRACE_MS > now.getTime()) {
    return { ok: false, reason: 'not_yet_valid' };
  }

  const key = certificate.publicKey;
  const modulusLength = key.asymmetricKeyDetails?.modulusLength;
  if (
    (key.asymmetricKeyType === 'rsa' ||
      key.asymmetricKeyType === 'rsa-pss' ||
      key.asymmetricKeyType === 'dsa') &&
    (modulusLength === undefined || modulusLength < MIN_RSA_MODULUS_BITS)
  ) {
    return { ok: false, reason: 'weak_key' };
  }
  if (key.asymmetricKeyType === 'ec') {
    const namedCurve = key.asymmetricKeyDetails?.namedCurve;
    if (namedCurve === undefined || !ALLOWED_EC_CURVES.has(namedCurve)) {
      return { ok: false, reason: 'weak_curve' };
    }
  }

  return {
    ok: true,
    facts: {
      subject: certificate.subject,
      fingerprint: certificate.fingerprint256,
      validFrom,
      validTo,
    },
  };
}

/**
 * The attribute mapping, narrowed to the fields an assertion may fill.
 *
 * Projected rather than passed through. The column is JSON, so a row can hold
 * keys nobody here declared — a hand-written INSERT, a future writer, an IdP
 * export pasted whole — and honouring those would put fields in the read
 * surface that the contract says cannot appear (`additionalProperties: false`),
 * and would let the SP endpoints (S11-d) read an identity out of a key no
 * validated write ever produced. Anything outside {@link
 * SSO_ATTRIBUTE_MAPPING_KEYS}, or any non-string value, is dropped.
 *
 * The non-object guard is narrowing, not a second opinion: a CHECK constraint
 * already keeps a scalar or an array out of the column. It is here so one bad
 * row reads as "not configured" rather than throwing — a 500 on the list
 * endpoint would hide every good row behind it, and a 500 on a login would be
 * indistinguishable from the IdP being down.
 */
export function readSsoAttributeMapping(value: unknown): SsoAttributeMapping {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const mapping: SsoAttributeMapping = {};
  for (const key of SSO_ATTRIBUTE_MAPPING_KEYS) {
    const attribute = (value as Record<string, unknown>)[key];
    if (typeof attribute === 'string') mapping[key] = attribute;
  }
  return mapping;
}

export type VerifiedDomainRejection =
  /** Empty, or nothing left after trimming. */
  | 'blank'
  /** Longer than {@link SSO_VERIFIED_DOMAIN_MAX_LENGTH}. */
  | 'too_long'
  /**
   * Not a bare hostname: a scheme, a path, a port, an `@`, a wildcard, a
   * leading or trailing dot, an underscore, or a label that starts/ends with a
   * hyphen. Also a single label with no dot — `localhost` names a machine, not
   * a domain an identity provider can be authoritative for.
   */
  | 'malformed'
  /** A consumer mailbox provider — see {@link PUBLIC_EMAIL_PROVIDERS}. */
  | 'public_provider';

/**
 * Domains no workspace may claim, however it claims them (§D134).
 *
 * These are consumer mailbox providers: millions of unrelated people hold an
 * address at each one, so "this identity provider is authoritative for
 * gmail.com" is not a statement that can be true. The ownership challenge would
 * refuse them anyway — nobody configuring a workspace reads
 * `postmaster@gmail.com` — but refusing them by name is worth more than
 * refusing them by silence: the owner who typed their own address's domain into
 * the field gets a sentence explaining why it cannot work, instead of a
 * challenge that is never answered and a federation that never provisions.
 *
 * Deliberately short and deliberately not exhaustive. A long list would imply
 * completeness this cannot have — there is no registry of consumer providers —
 * and the security of the feature does not rest on it: the proof does. This is
 * the common typo, named.
 */
export const PUBLIC_EMAIL_PROVIDERS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
]);

export type VerifiedDomainCheck =
  { ok: true; domain: string } | { ok: false; reason: VerifiedDomainRejection };

/**
 * The pattern a stored verified domain has to match, after normalisation.
 *
 * Two or more labels of letters, digits and inner hyphens. Deliberately narrow:
 * this value is compared for equality against the domain half of an address
 * that an identity provider asserts, so anything it accepts that an address can
 * never contain is dead weight, and anything ambiguous is a place for the two
 * sides to disagree. A wildcard is not in the grammar at all — see
 * {@link readVerifiedDomain}.
 */
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Normalise one domain an owner typed, or refuse it by name (§D116 MEDIUM (a)).
 *
 * Lower-cased and trimmed, and a trailing dot (the DNS root, which a copy from
 * a zone file carries) removed — all three are the same domain, and storing
 * them as three would mean an address matching one of them and not the others.
 * Normalising here rather than at match time is what lets the database compare
 * with plain equality: the expensive, forgettable half of the rule runs once
 * per write instead of once per sign-in.
 *
 * A `*.` wildcard is refused rather than expanded. It reads like a convenience
 * and is the whole vulnerability back again: `*.acme.test` verified by a
 * workspace that runs `acme.test` says nothing about who controls
 * `payroll.acme.test`, and the moment the product accepts one form of suffix
 * matching, "verified" stops meaning "we checked this exact name".
 */
export function readVerifiedDomain(raw: string): VerifiedDomainCheck {
  const domain = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!domain) return { ok: false, reason: 'blank' };
  if (domain.length > SSO_VERIFIED_DOMAIN_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  if (!HOSTNAME.test(domain)) return { ok: false, reason: 'malformed' };
  if (PUBLIC_EMAIL_PROVIDERS.has(domain)) return { ok: false, reason: 'public_provider' };
  return { ok: true, domain };
}

/**
 * The mailboxes a domain's ownership challenge may be sent to (§D134).
 *
 * RFC 2142's reserved local parts, minus the ones that name a service rather
 * than the operator. Whoever reads one of these speaks for the domain — that is
 * what makes the answer a proof rather than a claim — and the set is closed for
 * exactly that reason: letting the caller nominate the mailbox would let the
 * attacker in §D116 nominate one they control, which is the vulnerability with
 * an extra step. `postmaster@` is first because RFC 5321 requires every domain
 * that receives mail to have it.
 *
 * Order matters: it is the order the screen offers, and the first entry is the
 * default when a request names none.
 */
export const DOMAIN_CHALLENGE_MAILBOXES = [
  'postmaster',
  'admin',
  'administrator',
  'hostmaster',
  'webmaster',
] as const;

export type DomainChallengeMailbox = (typeof DOMAIN_CHALLENGE_MAILBOXES)[number];

/**
 * How long a mailed challenge token stays answerable.
 *
 * Three days rather than an hour: the person who has to read
 * `postmaster@acme.test` is usually not the person configuring the federation,
 * so the token has to survive being forwarded to another team and picked up the
 * next working day. Rather than an unbounded window, because the token is a
 * secret sitting in a shared mailbox and its whole value is that it expires
 * before the mailbox is archived, forwarded or breached.
 */
export const DOMAIN_CHALLENGE_TTL_MS = 72 * 3_600_000;

/**
 * How soon a challenge for the same domain may be sent again.
 *
 * The challenge endpoint sends mail to an address chosen by the *caller's*
 * claim, so an unbounded one is a way to make this product mail a stranger's
 * postmaster on demand. A minute is long enough that the loop is worthless and
 * short enough that "it did not arrive, send it again" is not an obstacle.
 * Enforced from the row's own `challenge_sent_at` rather than from a counter in
 * Redis: this bound must not disappear when a cache does (§D133/3).
 */
export const DOMAIN_CHALLENGE_RESEND_INTERVAL_MS = 60_000;

export type DomainChallengeRejection =
  /** No challenge has been sent, or the previous one was consumed. */
  | 'no_challenge'
  /** Sent more than {@link DOMAIN_CHALLENGE_TTL_MS} ago. */
  | 'expired';

/**
 * Is this row's challenge still answerable, and if not, why?
 *
 * The single place the token's lifetime is interpreted, for the same reason
 * {@link activePreviousCertificate} is the single place a rotation overlap is:
 * an expiry that two callers compute two ways is an expiry one of them gets
 * wrong. A row with no digest reads as "no challenge" whatever its timestamps
 * say — the digest is cleared when a token is spent, so this also closes replay
 * of a token that already worked.
 */
export function openDomainChallenge(
  row: { tokenHash: string | null; challengeSentAt: Date | null },
  now: Date,
): { ok: true; tokenHash: string } | { ok: false; reason: DomainChallengeRejection } {
  if (!row.tokenHash || !row.challengeSentAt) return { ok: false, reason: 'no_challenge' };
  if (now.getTime() - row.challengeSentAt.getTime() > DOMAIN_CHALLENGE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, tokenHash: row.tokenHash };
}

export type FederationUrlRejection =
  | 'unparseable'
  /** Not http(s) — `javascript:`, `data:`, `file:` and friends. */
  | 'scheme'
  /** Embedded `user:password@`. */
  | 'credentials'
  /** Carries a `#fragment`. */
  | 'fragment'
  /** Plain http to a host that is not loopback. */
  | 'insecure';

export type FederationUrlCheck =
  { ok: true; url: URL } | { ok: false; reason: FederationUrlRejection };

/**
 * Decide whether a URL may be stored as the IdP's SSO endpoint.
 *
 * This value ends up in a `Location` header pointing a signed-in-to-be user's
 * browser somewhere, so the scheme is the first thing that matters: `javascript:`
 * or `data:` here would be script execution attributed to our own origin, and a
 * protocol-relative `//evil.example` would be an open redirect. The storage
 * CHECK already anchors the column to `^https?://`; this is the policy layer
 * above it, which is where the TLS requirement belongs (the column deliberately
 * does not encode it — see the migration).
 *
 * TLS is required, with loopback excepted. An AuthnRequest carries no secret,
 * but the response to it carries an assertion, and plain http means a network
 * attacker can watch and rewrite the exchange. The exception exists so the mock
 * IdP harness (S11-c) can serve from 127.0.0.1 without the table having to know
 * about tests; a loopback address never leaves the machine, so there is no
 * network to attack.
 */
export function checkFederationUrl(raw: string): FederationUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'scheme' };
  }
  // Refused rather than stripped: credentials in a redirect target are handed to
  // whatever the browser talks to, and quietly dropping them would change where
  // the request authenticates without telling anyone.
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  // A fragment never reaches the server it points at, so an endpoint carrying
  // one is misconfigured — and appending our query to it would put `SAMLRequest`
  // somewhere the IdP will never read.
  if (url.hash) return { ok: false, reason: 'fragment' };
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return { ok: false, reason: 'insecure' };
  }

  return { ok: true, url };
}

/** Does this hostname name the machine itself? */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  // The whole of 127.0.0.0/8, not just 127.0.0.1 — `127.0.0.2` is equally local.
  return /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host);
}

/**
 * The outgoing certificate a rotation is still honouring, or `null`.
 *
 * The single place the overlap window is interpreted, so the read surface, the
 * screen and the assertion verifier (S11-b/S11-d) cannot disagree about when a
 * replaced certificate stops being trusted. A lapsed overlap reads exactly like
 * no overlap — the row keeps the bytes until the next write, but nothing above
 * this function can tell, which is the point: a certificate whose window has
 * closed must not be one lazy sweep away from verifying something.
 */
export function activePreviousCertificate(
  row: { previousCertificatePem: string | null; previousCertificateExpiresAt: Date | null },
  now: Date,
): { pem: string; expiresAt: Date } | null {
  const { previousCertificatePem: pem, previousCertificateExpiresAt: expiresAt } = row;
  if (!pem || !expiresAt) return null;
  if (expiresAt.getTime() <= now.getTime()) return null;
  return { pem, expiresAt };
}

/**
 * Is this connection actually closing the password door (NFR-S11 · S11-h)?
 *
 * The single place `enforced` is interpreted, for the same reason
 * `activePreviousCertificate` is the single place the rotation overlap is: the
 * flag is meaningless on its own. A connection that is switched off admits
 * nobody through SAML, so honouring its `enforced` would leave a workspace with
 * no door at all — and that state is not a bug to be prevented, it is the exact
 * state a workspace lands in when it disables a broken federation, which is how
 * it gets its password sign-in back.
 *
 * The login path applies the same pair in SQL (`auth_list_memberships`), where
 * it has to run for an unauthenticated caller with no tenant context. This is
 * the copy the write surface and the read surface share, so a screen can never
 * show "enforced" for a connection the sign-in path treats as open.
 */
export function isEnforcingSso(row: { enabled: boolean; enforced: boolean }): boolean {
  return row.enabled && row.enforced;
}
