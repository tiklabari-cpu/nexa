/**
 * The cryptography of the audit chain (NFR-C6 · C6-c), decided in code rather
 * than in Postgres: what the hash commits to, what the signature commits to,
 * and what the verifier is and is not able to see. The parts that need real
 * rows and a real transaction — positions handed out under a lock, retention's
 * watermark, an export ordered by chain position — are in
 * `test/integration/audit-chain.test.ts`.
 *
 * Every assertion here is written against a property, not a fixed digest. A
 * test that pinned literal hashes would fail the day the encoding changed for a
 * good reason and pass the day the key stopped being mixed in.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  chainPayload,
  chainRowHash,
  deriveChainKey,
  signExportPage,
  verifyAuditChain,
  verifyExportSignature,
  type ChainableRow,
  type VerifiableRow,
} from './audit-chain.js';

const SECRET = 'test-only-audit-chain-secret-0123456789abcdef';
const KEY = deriveChainKey(SECRET, 1n);

const row = (over: Partial<ChainableRow> = {}): ChainableRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  licenseId: 1n,
  chainSeq: 1n,
  action: 'auth.login',
  actorId: '22222222-2222-4222-8222-222222222222',
  actorType: 'agent',
  target: null,
  metadata: {},
  ip: null,
  createdAt: new Date('2026-08-15T09:00:00.000Z'),
  prevHash: null,
  ...over,
});

/** A run of `count` correctly chained entries, ready for the verifier. */
function chain(count: number, key = KEY): VerifiableRow[] {
  const rows: VerifiableRow[] = [];
  let prevHash: string | null = null;
  for (let i = 1; i <= count; i++) {
    const base = row({
      id: `0000000${i}-1111-4111-8111-111111111111`,
      chainSeq: BigInt(i),
      target: `entry-${i}`,
      createdAt: new Date(Date.UTC(2026, 7, 15, 9, 0, i)),
      prevHash,
    });
    const hash = chainRowHash(key, base);
    rows.push({ ...base, hash });
    prevHash = hash;
  }
  return rows;
}

describe('key derivation', () => {
  it('gives each workspace a different key', () => {
    // The point of deriving rather than sharing: learning one workspace's key
    // must not be learning another's, so a chain from tenant A cannot be used
    // to manufacture one for tenant B.
    expect(deriveChainKey(SECRET, 1n).equals(deriveChainKey(SECRET, 2n))).toBe(false);
  });

  it('gives the same workspace the same key every time', () => {
    // Verification a year later has to reach the same value, or every entry
    // ever written fails against itself.
    expect(deriveChainKey(SECRET, 7n).equals(deriveChainKey(SECRET, 7n))).toBe(true);
  });

  it('changes completely when the root changes', () => {
    expect(deriveChainKey(SECRET, 1n).equals(deriveChainKey(`${SECRET}x`, 1n))).toBe(false);
  });
});

describe('entry hash', () => {
  it('changes when any field of the entry changes', () => {
    // Field by field, because "the hash covers the row" is only true if it is
    // true of every column an attacker would want to edit. `metadata` is here
    // as much as `action`: rewriting a role change's from/to is exactly the
    // kind of edit that makes a trail lie while looking complete.
    const original = chainRowHash(KEY, row());
    const mutations: Array<Partial<ChainableRow>> = [
      { id: '99999999-1111-4111-8111-111111111111' },
      { chainSeq: 2n },
      { action: 'auth.login_failed' },
      { actorId: null },
      { actorType: 'system' },
      { target: 'account:abc' },
      { metadata: { from: 'agent' } },
      { ip: '203.0.113.9' },
      { createdAt: new Date('2026-08-15T09:00:00.001Z') },
      { prevHash: 'something' },
    ];
    for (const mutation of mutations) {
      expect(chainRowHash(KEY, row(mutation)), Object.keys(mutation)[0]).not.toBe(original);
    }
  });

  it('is not recomputable without the key', () => {
    // The whole reason this is an HMAC and not a digest. A digest chain is
    // recomputable by anyone who can read the table, which makes it a checksum
    // against corruption — useless against somebody who deletes a row and
    // rebuilds the rest.
    expect(chainRowHash(deriveChainKey('another-root-secret-0123456789ab', 1n), row())).not.toBe(
      chainRowHash(KEY, row()),
    );
  });

  it('cannot be forged by moving a field boundary', () => {
    // The reason the payload is a JSON array rather than a delimited string.
    // With `a|b` framing, an entry whose target ends where the next field
    // begins can impersonate a different entry; JSON quotes every string, so
    // no value can smuggle a field break.
    const a = chainRowHash(KEY, row({ action: 'auth.login', target: 'x' }));
    const b = chainRowHash(KEY, row({ action: 'auth.login|x', target: '' }));
    expect(a).not.toBe(b);
  });

  it('survives metadata coming back from JSONB in another key order', () => {
    // JSONB stores an object as a sorted map, so an entry read back does not
    // have the key order it was written with. Without canonicalisation every
    // entry with more than one metadata key would fail its own verification the
    // moment it left memory.
    expect(chainRowHash(KEY, row({ metadata: { b: 1, a: 2 } }))).toBe(
      chainRowHash(KEY, row({ metadata: { a: 2, b: 1 } })),
    );
  });

  it('still distinguishes different metadata values', () => {
    // Canonicalisation must normalise order, not content.
    expect(chainRowHash(KEY, row({ metadata: { a: 1 } }))).not.toBe(
      chainRowHash(KEY, row({ metadata: { a: 2 } })),
    );
  });

  it('carries a version tag, so a future encoding cannot be confused with this one', () => {
    expect(chainPayload(row())).toContain('nexa.audit.chain.v1.row');
  });
});

describe('canonical JSON', () => {
  it('sorts keys at every depth', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('leaves array order alone', () => {
    // Arrays are ordered data — `['admin','agent']` and `['agent','admin']` are
    // different statements about what happened.
    expect(canonicalJson({ roles: ['b', 'a'] })).toBe('{"roles":["b","a"]}');
  });
});

describe('export signature', () => {
  const subject = { licenseId: 1n, count: 2, firstSeq: 4n, lastSeq: 5n, body: 'a\nb\n' };

  it('verifies the page it was made for', () => {
    expect(verifyExportSignature(KEY, subject, signExportPage(KEY, subject))).toBe(true);
  });

  it('fails when a single byte of the body changes', () => {
    // The signature is over the bytes delivered, so this is the assertion the
    // auditor actually relies on: the file on their disk is the file we sent.
    const signature = signExportPage(KEY, subject);
    expect(verifyExportSignature(KEY, { ...subject, body: 'a\nc\n' }, signature)).toBe(false);
  });

  it('fails when the claimed range changes', () => {
    // The range is in the body already, but a value that is read and not signed
    // is a value an attacker gets to choose — and this is the one a human reads
    // off two files to decide whether they are consecutive.
    const signature = signExportPage(KEY, subject);
    expect(verifyExportSignature(KEY, { ...subject, lastSeq: 6n }, signature)).toBe(false);
    expect(verifyExportSignature(KEY, { ...subject, count: 3 }, signature)).toBe(false);
  });

  it("cannot be verified with another workspace's key", () => {
    expect(
      verifyExportSignature(deriveChainKey(SECRET, 2n), subject, signExportPage(KEY, subject)),
    ).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // `timingSafeEqual` throws on a length mismatch, and a thrown error inside
    // a verification helper reads as "crashed", not "did not verify".
    expect(verifyExportSignature(KEY, subject, 'short')).toBe(false);
    expect(verifyExportSignature(KEY, subject, '')).toBe(false);
  });

  it('does not carry the key into what it signs', () => {
    // PLAN §C-A22: the key is not in the export, so a signature anybody can
    // verify is not a signature — verification belongs to whoever holds it.
    expect(signExportPage(KEY, subject)).not.toContain(SECRET);
  });
});

describe('chain verification', () => {
  it('accepts an intact run', () => {
    const result = verifyAuditChain(chain(4), { key: KEY, prunedThroughSeq: 0n });
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(4);
    expect(result.firstSeq).toBe('1');
    expect(result.lastSeq).toBe('4');
  });

  it('catches an entry removed from the middle', () => {
    // The headline case. One row deleted from the database leaves the rest
    // perfectly valid — except that a position is missing, and positions are
    // handed out gaplessly, so nothing else can produce the hole.
    const rows = chain(4);
    const result = verifyAuditChain([rows[0]!, rows[1]!, rows[3]!], { key: KEY });
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.kind)).toEqual(['sequence_gap']);
  });

  it('reports a gap once, not as a gap and a broken link', () => {
    // A deletion necessarily breaks the link across it. Reporting both would
    // dress one incident up as two and make a finding count meaningless.
    const rows = chain(6);
    const result = verifyAuditChain([rows[0]!, rows[4]!, rows[5]!], { key: KEY });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('sequence_gap');
  });

  it('catches an entry whose content was altered', () => {
    const rows = chain(3);
    const tampered = rows.map((r, i) => (i === 1 ? { ...r, action: 'auth.login_failed' } : r));
    const kinds = verifyAuditChain(tampered, { key: KEY }).findings.map((f) => f.kind);
    expect(kinds).toContain('hash_mismatch');
  });

  it('catches an alteration that was re-hashed but not re-linked', () => {
    // The next step an attacker takes: edit the row *and* recompute its hash.
    // They cannot, without the key — but if they could, the entry after it
    // still points at the old value, so the forgery has to run to the end of
    // history or not at all.
    const rows = chain(3);
    const edited = { ...rows[1]!, action: 'auth.login_failed' };
    const relinked = [
      rows[0]!,
      { ...edited, hash: chainRowHash(KEY, { ...edited, chainSeq: 2n }) },
      rows[2]!,
    ];
    const kinds = verifyAuditChain(relinked, { key: KEY }).findings.map((f) => f.kind);
    expect(kinds).toContain('broken_link');
  });

  it('catches entries removed from the front of the retained trail', () => {
    // The cut that leaves a perfectly contiguous run behind, and the reason
    // `pruned_through_seq` exists at all: without the watermark this run is
    // indistinguishable from a trail retention had shortened legitimately.
    const rows = chain(5).slice(2);
    expect(verifyAuditChain(rows, { key: KEY, prunedThroughSeq: 0n }).findings[0]?.kind).toBe(
      'start_mismatch',
    );
    // Same rows, but retention says it pruned exactly those two — no finding.
    expect(verifyAuditChain(rows, { key: KEY, prunedThroughSeq: 2n }).ok).toBe(true);
  });

  it('makes no claim about the start when it is verifying one page', () => {
    // A page from the middle of a feed legitimately begins wherever the last
    // page ended, and its predecessor's hash is not in it. Claiming otherwise
    // would make every page after the first look tampered with.
    expect(verifyAuditChain(chain(5).slice(2), { key: KEY }).ok).toBe(true);
  });

  it('flags an entry written after genesis that carries no chain', () => {
    // Otherwise "unchained" is a way to write to the log without joining it:
    // an unchained row breaks no link and leaves no hole.
    const rows = chain(2);
    const smuggled: VerifiableRow = {
      ...row({ createdAt: new Date('2026-08-15T09:00:30.000Z') }),
      chainSeq: null,
      prevHash: null,
      hash: null,
    };
    const result = verifyAuditChain([...rows, smuggled], {
      key: KEY,
      genesisAt: new Date('2026-08-15T08:00:00.000Z'),
    });
    expect(result.findings.map((f) => f.kind)).toEqual(['unchained_entry']);
  });

  it('leaves pre-genesis entries alone', () => {
    // Entries written before the chain existed cannot be back-computed without
    // the key, so they are honestly unchained rather than forged — and holding
    // them against the chain would make every deployment start out "tampered".
    const legacy: VerifiableRow = {
      ...row({ createdAt: new Date('2020-01-01T00:00:00.000Z') }),
      chainSeq: null,
      prevHash: null,
      hash: null,
    };
    const result = verifyAuditChain([legacy, ...chain(2)], {
      key: KEY,
      genesisAt: new Date('2026-08-15T08:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
  });

  it('fails everything under the wrong key', () => {
    const wrong = deriveChainKey(SECRET, 999n);
    const result = verifyAuditChain(chain(3), { key: wrong });
    expect(result.ok).toBe(false);
    expect(result.findings.filter((f) => f.kind === 'hash_mismatch')).toHaveLength(3);
  });

  it('has nothing to say about an empty trail', () => {
    const result = verifyAuditChain([], { key: KEY });
    expect(result).toMatchObject({ ok: true, checked: 0, firstSeq: null, lastSeq: null });
  });
});
