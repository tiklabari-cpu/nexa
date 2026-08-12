import { describe, expect, it } from 'vitest';
import {
  CERTIFICATE_CHAIN_PEM,
  EXPIRED_CERTIFICATE_PEM,
  NOT_YET_VALID_CERTIFICATE_PEM,
  ROTATED_CERTIFICATE_PEM,
  UNPARSEABLE_CERTIFICATE_PEM,
  VALID_CERTIFICATE_FINGERPRINT,
  VALID_CERTIFICATE_PEM,
  WEAK_CERTIFICATE_PEM,
} from '../../test/helpers/certificates.js';
import {
  activePreviousCertificate,
  checkFederationUrl,
  CERTIFICATE_NOT_BEFORE_GRACE_MS,
  inspectIdpCertificate,
  isLoopbackHost,
} from './sso-connection.js';

/** A fixed "now" inside every usable fixture's validity window. */
const NOW = new Date('2026-08-12T00:00:00.000Z');

/** The reason a rejection gave, or `'accepted'`. Keeps the assertions one-line. */
function certificateVerdict(pem: string, now: Date = NOW): string {
  const result = inspectIdpCertificate(pem, now);
  return result.ok ? 'accepted' : result.reason;
}

function urlVerdict(raw: string): string {
  const result = checkFederationUrl(raw);
  return result.ok ? result.url.toString() : `rejected:${result.reason}`;
}

describe('inspectIdpCertificate', () => {
  // --- Rejections first: this decides what may become a trust anchor. --------

  it('rejects anything that is not a certificate', () => {
    // Certificate-shaped but not a certificate: the exact input the storage
    // CHECK (which only looks for the BEGIN line) lets through, so this is what
    // proves the endpoint parses rather than pattern-matches.
    expect(certificateVerdict(UNPARSEABLE_CERTIFICATE_PEM)).toBe('unparseable');
    expect(certificateVerdict('')).toBe('unparseable');
    expect(certificateVerdict('not a certificate at all')).toBe('unparseable');
    // A fingerprint pasted where the certificate belongs — a real mix-up, since
    // an IdP console shows both next to each other.
    expect(certificateVerdict(VALID_CERTIFICATE_FINGERPRINT)).toBe('unparseable');
  });

  it('rejects a chain rather than silently trusting its first certificate', () => {
    // `new X509Certificate` reads the first block and ignores the rest, so a
    // pasted chain would be stored whole, displayed whole, and verified against
    // one — an operator would believe two certificates are trusted when one is.
    expect(certificateVerdict(CERTIFICATE_CHAIN_PEM)).toBe('multiple');
  });

  it('rejects an expired certificate', () => {
    expect(certificateVerdict(EXPIRED_CERTIFICATE_PEM)).toBe('expired');
  });

  it('rejects a certificate whose validity has not started', () => {
    // Refused for the same reason as an expired one: it cannot verify the *next*
    // assertion, which is the only thing this field is for.
    expect(certificateVerdict(NOT_YET_VALID_CERTIFICATE_PEM)).toBe('not_yet_valid');
  });

  it('forgives clock skew at the start of validity, but not at the end', () => {
    const validFrom = new Date('2025-01-01T00:00:00.000Z');

    // Inside the grace: our clock is a little behind the IdP's CA, which is an
    // ordinary difference between two machines, not a misconfiguration.
    const justBefore = new Date(validFrom.getTime() - CERTIFICATE_NOT_BEFORE_GRACE_MS + 1_000);
    expect(certificateVerdict(VALID_CERTIFICATE_PEM, justBefore)).toBe('accepted');

    // Beyond it: a certificate that starts next week.
    const wellBefore = new Date(validFrom.getTime() - CERTIFICATE_NOT_BEFORE_GRACE_MS - 1_000);
    expect(certificateVerdict(VALID_CERTIFICATE_PEM, wellBefore)).toBe('not_yet_valid');

    // Expiry gets no grace at all — expired is expired.
    const validTo = new Date('2125-01-01T00:00:00.000Z');
    expect(certificateVerdict(VALID_CERTIFICATE_PEM, validTo)).toBe('expired');
    expect(certificateVerdict(VALID_CERTIFICATE_PEM, new Date(validTo.getTime() - 1_000))).toBe(
      'accepted',
    );
  });

  it('rejects a key too small to be trusted with sign-in', () => {
    // 1024-bit RSA, in date, correctly formed. Everything about it looks fine
    // except the one property that decides whether a signature can be forged.
    expect(certificateVerdict(WEAK_CERTIFICATE_PEM)).toBe('weak_key');
  });

  // --- What it accepts, and what it reports ---------------------------------

  it('accepts a well-formed certificate and reports the facts worth auditing', () => {
    const result = inspectIdpCertificate(VALID_CERTIFICATE_PEM, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.facts.subject).toContain('idp.example.test');
    // The fingerprint is what an audit entry records and what an admin compares
    // against their IdP console — the one certificate-derived value that leaves
    // this module for the trail.
    expect(result.facts.fingerprint).toBe(VALID_CERTIFICATE_FINGERPRINT);
    expect(result.facts.validFrom.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(result.facts.validTo.toISOString()).toBe('2125-01-01T00:00:00.000Z');
  });

  it('gives two different certificates two different fingerprints', () => {
    // The rotation check compares fingerprints to decide whether a save is a
    // rotation at all, so a collision here would make one look like the other.
    const a = inspectIdpCertificate(VALID_CERTIFICATE_PEM, NOW);
    const b = inspectIdpCertificate(ROTATED_CERTIFICATE_PEM, NOW);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.facts.fingerprint).not.toBe(b.facts.fingerprint);
  });

  it('does not carry state between calls', () => {
    // The BEGIN-block counter is a module-level regex with the global flag, and
    // a global regex remembers `lastIndex`. Two identical calls must agree.
    expect(certificateVerdict(VALID_CERTIFICATE_PEM)).toBe('accepted');
    expect(certificateVerdict(VALID_CERTIFICATE_PEM)).toBe('accepted');
    expect(certificateVerdict(CERTIFICATE_CHAIN_PEM)).toBe('multiple');
    expect(certificateVerdict(CERTIFICATE_CHAIN_PEM)).toBe('multiple');
  });
});

describe('checkFederationUrl', () => {
  // --- Rejections first: this value becomes a browser redirect target. ------

  it('rejects every scheme but http and https', () => {
    // The whole reason the scheme is checked here rather than trusted: this
    // string ends up in a `Location`, so `javascript:` would be script execution
    // attributed to our own origin.
    expect(urlVerdict('javascript:alert(1)')).toBe('rejected:scheme');
    expect(urlVerdict('data:text/html,<script>alert(1)</script>')).toBe('rejected:scheme');
    expect(urlVerdict('file:///etc/passwd')).toBe('rejected:scheme');
  });

  it('rejects a URL it cannot parse, including a protocol-relative one', () => {
    // `//evil.example/sso` has no scheme, so `new URL` refuses it outright —
    // which is the answer we want, since a browser would have read it as an
    // absolute address on whatever origin served the redirect.
    expect(urlVerdict('//evil.example/sso')).toBe('rejected:unparseable');
    expect(urlVerdict('/saml/sso')).toBe('rejected:unparseable');
    expect(urlVerdict('idp.example.test/sso')).toBe('rejected:unparseable');
    expect(urlVerdict('')).toBe('rejected:unparseable');
  });

  it('rejects embedded credentials', () => {
    expect(urlVerdict('https://user:secret@idp.example.test/sso')).toBe('rejected:credentials');
    expect(urlVerdict('https://user@idp.example.test/sso')).toBe('rejected:credentials');
  });

  it('rejects a fragment', () => {
    // Never sent to the server it points at, so `SAMLRequest` appended to a URL
    // carrying one would go somewhere the IdP does not read.
    expect(urlVerdict('https://idp.example.test/sso#anchor')).toBe('rejected:fragment');
  });

  it('rejects plain http to a host that is not loopback', () => {
    expect(urlVerdict('http://idp.example.test/sso')).toBe('rejected:insecure');
    // Including one that merely *looks* local.
    expect(urlVerdict('http://localhost.evil.example/sso')).toBe('rejected:insecure');
    expect(urlVerdict('http://127.0.0.1.evil.example/sso')).toBe('rejected:insecure');
  });

  // --- What it accepts ------------------------------------------------------

  it('accepts https and returns the normalised URL', () => {
    expect(urlVerdict('https://idp.example.test/saml/sso')).toBe(
      'https://idp.example.test/saml/sso',
    );
    // Host case and an implicit path are the same endpoint; storing the parsed
    // form means what is stored is what the redirect is built from.
    expect(urlVerdict('https://IdP.Example.Test')).toBe('https://idp.example.test/');
    expect(urlVerdict('https://idp.example.test/sso?tenant=nexa')).toBe(
      'https://idp.example.test/sso?tenant=nexa',
    );
  });

  it('accepts plain http on loopback, so a local IdP harness can be tested', () => {
    // The exception the storage CHECK deliberately left to this layer (S11-c
    // runs a mock IdP on 127.0.0.1). A loopback address never leaves the
    // machine, so there is no network on which to attack the exchange.
    expect(urlVerdict('http://127.0.0.1:8088/sso')).toBe('http://127.0.0.1:8088/sso');
    expect(urlVerdict('http://localhost:8088/sso')).toBe('http://localhost:8088/sso');
    expect(urlVerdict('http://[::1]:8088/sso')).toBe('http://[::1]:8088/sso');
  });
});

describe('isLoopbackHost', () => {
  it('accepts the whole loopback range and the names for it', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    // 127.0.0.0/8 is loopback in its entirety, not just .1.
    expect(isLoopbackHost('127.0.0.2')).toBe(true);
    expect(isLoopbackHost('127.255.255.254')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('refuses hosts that only resemble one', () => {
    expect(isLoopbackHost('127.0.0.1.evil.example')).toBe(false);
    expect(isLoopbackHost('localhost.evil.example')).toBe(false);
    expect(isLoopbackHost('idp.example.test')).toBe(false);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
    // Private, but not loopback — it leaves the machine, so http is not safe.
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });
});

describe('activePreviousCertificate', () => {
  const pem = ROTATED_CERTIFICATE_PEM;

  it('reports nothing when no rotation left an overlap', () => {
    expect(
      activePreviousCertificate(
        { previousCertificatePem: null, previousCertificateExpiresAt: null },
        NOW,
      ),
    ).toBeNull();
  });

  it('reports the certificate while the window is open', () => {
    const expiresAt = new Date(NOW.getTime() + 3_600_000);
    expect(
      activePreviousCertificate(
        { previousCertificatePem: pem, previousCertificateExpiresAt: expiresAt },
        NOW,
      ),
    ).toEqual({ pem, expiresAt });
  });

  it('reports nothing once the window has closed', () => {
    // The property the whole overlap design rests on: a lapsed certificate is
    // indistinguishable from no certificate above this function, so it can never
    // be one forgotten sweep away from verifying an assertion.
    const expiresAt = new Date(NOW.getTime() - 1_000);
    expect(
      activePreviousCertificate(
        { previousCertificatePem: pem, previousCertificateExpiresAt: expiresAt },
        NOW,
      ),
    ).toBeNull();

    // And exactly at the deadline: the window is closed, not still open.
    expect(
      activePreviousCertificate(
        { previousCertificatePem: pem, previousCertificateExpiresAt: NOW },
        NOW,
      ),
    ).toBeNull();
  });

  it('reports nothing when only half an overlap is stored', () => {
    // The storage CHECK makes this unreachable through the database; the guard
    // is here so a half-built object in code cannot become an unbounded trust
    // anchor either.
    expect(
      activePreviousCertificate(
        { previousCertificatePem: pem, previousCertificateExpiresAt: null },
        NOW,
      ),
    ).toBeNull();
    expect(
      activePreviousCertificate(
        { previousCertificatePem: null, previousCertificateExpiresAt: new Date(NOW.getTime() + 1) },
        NOW,
      ),
    ).toBeNull();
  });
});
