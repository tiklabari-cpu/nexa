/**
 * Making the audit trail able to prove its own completeness (NFR-C6 · C6-c).
 *
 * An append-only table stops the application erasing evidence. It says nothing
 * about anyone who reaches the database underneath the application, and nothing
 * at all about a file that has left the building — a `.ndjson` on an auditor's
 * desk is a claim, and until this module existed the only reason to believe it
 * was that we said so. The value of an audit trail is not that it cannot be
 * deleted. It is that a deletion is *visible*.
 *
 * Three pieces carry that, and they are one mechanism:
 *
 *   - **A per-workspace position** (`chain_seq`), handed out under a row lock on
 *     `audit_chain_heads` and gapless by construction. A missing number is a
 *     removed entry. Nothing else can produce one.
 *   - **A link** (`prev_hash` → `hash`). Each entry's hash is an HMAC over its
 *     own content *and* the hash before it, so changing any field of any entry
 *     breaks every link from there onward — you cannot edit one row, you have to
 *     forge the rest of history.
 *   - **A detached signature** over an exported page, binding the exact bytes
 *     delivered to the range of positions they claim to cover.
 *
 * The key never leaves this process. It is derived per licence from
 * `AUDIT_CHAIN_SECRET`, which lives in the deployment's environment and not in
 * the database — so an attacker holding the database can still delete rows (they
 * always could) but cannot recompute a chain that hides the deletion. This is
 * the whole reason the hash is an HMAC rather than a plain digest: a digest
 * chain is recomputable by anyone who can read the table, which makes it a
 * checksum against corruption, not evidence against tampering.
 *
 * For the same reason the key is not in the export (PLAN §C-A22). A signature
 * verifiable by everyone who receives it is a decoration; verification is the
 * job of whoever holds the key, which is the deployment and the auditor it
 * chooses to hand a copy to.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Version tag mixed into every derivation, hash and signature.
 *
 * Bumping it changes every value this module produces, which is the point: if
 * the canonical encoding below ever has to change, old entries must not
 * silently start failing verification against new rules. A verifier reads the
 * version off the record and applies the rules of that version.
 */
export const AUDIT_CHAIN_VERSION = 1;

const KEY_LABEL = `nexa.audit.chain.v${AUDIT_CHAIN_VERSION}.key`;
const ROW_LABEL = `nexa.audit.chain.v${AUDIT_CHAIN_VERSION}.row`;
const EXPORT_LABEL = `nexa.audit.export.v${AUDIT_CHAIN_VERSION}.sig`;

/**
 * The per-workspace key.
 *
 * Derived rather than shared so that one workspace's chain cannot be used to
 * forge another's: an insider who somehow learns tenant A's derived key learns
 * nothing about tenant B, because inverting HMAC to recover the root is the
 * thing HMAC is built not to allow. The licence id is the only input besides the
 * root — it is stable, unique, and already the identity every other tenant
 * boundary in the platform is drawn on.
 */
export function deriveChainKey(secret: string, licenseId: bigint): Buffer {
  return createHmac('sha256', secret).update(`${KEY_LABEL}|${licenseId}`, 'utf8').digest();
}

/** The fields of an entry that the chain commits to. */
export interface ChainableRow {
  id: string;
  licenseId: bigint;
  chainSeq: bigint;
  action: string;
  actorId: string | null;
  actorType: string;
  target: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: Date;
  prevHash: string | null;
}

/**
 * The bytes an entry's HMAC is taken over.
 *
 * A JSON array rather than a delimited string, because a delimited encoding is
 * forgeable: with `a|b` as the separator, an entry whose `target` is `x|y` and
 * one whose target is `x` followed by a field starting `y` produce the same
 * bytes, and an attacker who controls one field controls the boundary. JSON
 * quotes and escapes every string, so no value can impersonate a field break.
 *
 * Positional, not keyed: field *names* are not part of the evidence, and a
 * rename would otherwise invalidate the entire history for no reason.
 *
 * `metadata` goes through `canonicalJson` because it round-trips through JSONB,
 * which does not preserve key order — the same object read back would otherwise
 * hash differently from the one that was written, and every entry would fail its
 * own verification.
 */
export function chainPayload(row: ChainableRow): string {
  return JSON.stringify([
    ROW_LABEL,
    row.licenseId.toString(),
    row.chainSeq.toString(),
    row.id,
    row.createdAt.toISOString(),
    row.action,
    row.actorType,
    row.actorId,
    row.target,
    canonicalJson(row.metadata),
    row.ip,
    row.prevHash,
  ]);
}

/** An entry's hash: HMAC-SHA256 of `chainPayload` under the workspace's key. */
export function chainRowHash(key: Buffer, row: ChainableRow): string {
  return createHmac('sha256', key).update(chainPayload(row), 'utf8').digest('base64url');
}

/**
 * JSON with every object's keys in a fixed order, recursively.
 *
 * JSONB stores an object as a sorted map and hands it back in its own order, so
 * `{b:1,a:2}` written today reads back as `{a:2,b:1}`. Hashing the raw
 * `JSON.stringify` would therefore make an entry fail against itself the moment
 * it is read from the database rather than held in memory. Sorting on both sides
 * removes the question.
 *
 * Two JSONB normalisations are accepted rather than fought: duplicate keys are
 * collapsed (the last wins) and numbers are re-rendered from `numeric`. Audit
 * metadata is counts, booleans, short identifiers and arrays of them by
 * construction — `sanitizeAuditMetadata` is upstream of anything richer — so
 * neither reaches the values this codebase actually writes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) sorted[key] = sortDeep(source[key]);
  return sorted;
}

// --- Export signature -------------------------------------------------------

/**
 * What an export signature covers.
 *
 * The body digest binds the exact bytes: change one character of one record and
 * the signature stops matching. The range and count are in there as well, even
 * though the body already contains them, because they are what a *human* reads
 * off the signature line when deciding whether two files are consecutive — and
 * a value that is checked but not signed is a value an attacker gets to choose.
 */
export interface ExportSignatureSubject {
  licenseId: bigint;
  /** Number of records in the body. */
  count: number;
  /** Chain position of the first and last record, or null for an empty page. */
  firstSeq: bigint | null;
  lastSeq: bigint | null;
  /** The exact NDJSON bytes delivered. */
  body: string;
}

/**
 * Sign one exported page.
 *
 * Detached, never inline. An inline signature would have to be a line in the
 * body, and C6-b's format rule — *every line is a record* — is what lets a
 * consumer split on `\n`, parse each half independently and concatenate two
 * pages into one file without a merge step. A signature line would break every
 * one of those, and a consumer that skipped it would be parsing evidence it had
 * chosen not to check.
 */
export function signExportPage(key: Buffer, subject: ExportSignatureSubject): string {
  const digest = createHash('sha256').update(subject.body, 'utf8').digest('base64url');
  const payload = JSON.stringify([
    EXPORT_LABEL,
    subject.licenseId.toString(),
    subject.count,
    subject.firstSeq === null ? null : subject.firstSeq.toString(),
    subject.lastSeq === null ? null : subject.lastSeq.toString(),
    digest,
  ]);
  return createHmac('sha256', key).update(payload, 'utf8').digest('base64url');
}

/** Constant-time check of a signature produced by `signExportPage`. */
export function verifyExportSignature(
  key: Buffer,
  subject: ExportSignatureSubject,
  signature: string,
): boolean {
  const expected = Buffer.from(signExportPage(key, subject), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

// --- Verification -----------------------------------------------------------

export type ChainFindingKind =
  /** A position is missing between two surviving entries — an entry was removed. */
  | 'sequence_gap'
  /** The retained trail does not start where retention says it should. */
  | 'start_mismatch'
  /** An entry's `prev_hash` does not name the entry before it. */
  | 'broken_link'
  /** An entry's content no longer produces its own hash — it was altered. */
  | 'hash_mismatch'
  /** An entry written after the chain began carries no chain at all. */
  | 'unchained_entry';

export interface ChainFinding {
  kind: ChainFindingKind;
  /** The entry the finding is about; null for a gap, which is about an absence. */
  id: string | null;
  /** Position involved — the expected one for a gap, the entry's own otherwise. */
  seq: string | null;
  detail: string;
}

export interface ChainVerification {
  ok: boolean;
  /** Entries actually hashed and linked. */
  checked: number;
  firstSeq: string | null;
  lastSeq: string | null;
  findings: ChainFinding[];
}

export interface VerifyChainOptions {
  key: Buffer;
  /**
   * How far retention has legitimately pruned, from `audit_chain_heads`. Given,
   * the first surviving entry is expected at `prunedThroughSeq + 1` and
   * anything later is a `start_mismatch` — which is what closes the hole where
   * an attacker deletes from the *front* of the retained trail and leaves the
   * remainder perfectly contiguous. Omitted (verifying a page rather than a
   * whole trail), the start is not claimed either way.
   */
  prunedThroughSeq?: bigint | null;
  /**
   * When this licence's chain began. An entry written after it and left
   * unchained is a finding: without this check, "unchained" would be a way to
   * hide an entry in plain sight, since an unchained row breaks no link.
   */
  genesisAt?: Date | null;
}

/** A row as the verifier reads it — chained or, for the finding above, not. */
export interface VerifiableRow extends Omit<ChainableRow, 'chainSeq' | 'prevHash'> {
  chainSeq: bigint | null;
  prevHash: string | null;
  hash: string | null;
}

/**
 * Walk a run of entries and report every way it fails to be an intact chain.
 *
 * Reports rather than throws, and reports *all* findings rather than the first.
 * PLAN's open question — stop the export or mark it — resolves to mark: an
 * export that refuses to run because the trail is damaged converts a detected
 * tampering into a silent halt of the feed, which is the outcome an attacker
 * wanted. Evidence of damage is itself evidence, and it belongs downstream in
 * the SIEM where somebody is looking, not in a log line on the box that was
 * tampered with.
 *
 * `rows` must be ordered by `chainSeq` ascending. Unchained rows sort last and
 * are checked only against `genesisAt`.
 */
export function verifyAuditChain(
  rows: readonly VerifiableRow[],
  options: VerifyChainOptions,
): ChainVerification {
  const findings: ChainFinding[] = [];
  const chained = rows.filter((row): row is VerifiableRow & { chainSeq: bigint; hash: string } => {
    if (row.chainSeq !== null && row.hash !== null) return true;
    // Before the chain existed there was nothing to join, so those entries are
    // not evidence of anything. After genesis, an unchained entry means the
    // writer was bypassed.
    if (options.genesisAt && row.createdAt >= options.genesisAt) {
      findings.push({
        kind: 'unchained_entry',
        id: row.id,
        seq: null,
        detail: `entry written at ${row.createdAt.toISOString()} carries no chain, but this workspace's chain began at ${options.genesisAt.toISOString()}`,
      });
    }
    return false;
  });

  let previous: (VerifiableRow & { chainSeq: bigint; hash: string }) | null = null;

  for (const row of chained) {
    if (previous === null) {
      const pruned = options.prunedThroughSeq ?? null;
      if (pruned !== null && row.chainSeq !== pruned + 1n) {
        findings.push({
          kind: 'start_mismatch',
          id: row.id,
          seq: row.chainSeq.toString(),
          detail: `retained trail starts at ${row.chainSeq}, but retention has only pruned through ${pruned} — entries ${pruned + 1n}…${row.chainSeq - 1n} are unaccounted for`,
        });
      }
    } else {
      if (row.chainSeq !== previous.chainSeq + 1n) {
        findings.push({
          kind: 'sequence_gap',
          id: null,
          seq: (previous.chainSeq + 1n).toString(),
          detail: `positions ${previous.chainSeq + 1n}…${row.chainSeq - 1n} are missing between two surviving entries`,
        });
      }
      // A gap makes the link legitimately not match, so only claim a broken
      // link when the two entries really are adjacent. Reporting both would
      // dress one deletion up as two independent problems.
      else if (row.prevHash !== previous.hash) {
        findings.push({
          kind: 'broken_link',
          id: row.id,
          seq: row.chainSeq.toString(),
          detail: `entry does not point at position ${previous.chainSeq}`,
        });
      }
    }

    const recomputed = chainRowHash(options.key, {
      id: row.id,
      licenseId: row.licenseId,
      chainSeq: row.chainSeq,
      action: row.action,
      actorId: row.actorId,
      actorType: row.actorType,
      target: row.target,
      metadata: row.metadata,
      ip: row.ip,
      createdAt: row.createdAt,
      prevHash: row.prevHash,
    });
    if (recomputed !== row.hash) {
      findings.push({
        kind: 'hash_mismatch',
        id: row.id,
        seq: row.chainSeq.toString(),
        detail: `entry at position ${row.chainSeq} no longer produces its own hash — its content or timestamp was altered`,
      });
    }

    previous = row;
  }

  return {
    ok: findings.length === 0,
    checked: chained.length,
    firstSeq: chained[0]?.chainSeq.toString() ?? null,
    lastSeq: previous?.chainSeq.toString() ?? null,
    findings,
  };
}
