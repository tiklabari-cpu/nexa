/**
 * The parts of the SIEM export that are decided in code rather than by the
 * database: the cursor's encoding, the horizon's arithmetic, and the NDJSON
 * shape. The parts that need real Postgres and real RLS — ordering, keyset
 * paging, no-skip, cross-tenant — are in
 * `test/integration/siem-export.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIT_EXPORT_LIMITS,
  decodeExportCursor,
  encodeExportCursor,
  exportHorizon,
  toNdjson,
  toRecord,
  type AuditExportRecord,
} from './audit-export.js';

const row = (over: Partial<Parameters<typeof toRecord>[0]> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  licenseId: 42n,
  action: 'auth.login',
  actorId: '22222222-2222-4222-8222-222222222222',
  actorType: 'agent',
  target: null,
  metadata: {},
  ip: null,
  createdAt: new Date('2026-08-15T09:00:00.000Z'),
  chainSeq: 7n,
  prevHash: 'prev',
  hash: 'own',
  ...over,
});

describe('export cursor', () => {
  it('round-trips a position', () => {
    const cursor = { createdAt: '2026-08-15T09:00:00.000Z', id: 'abc' };
    expect(decodeExportCursor(encodeExportCursor(cursor))).toEqual(cursor);
  });

  it('is opaque — a caller cannot read a workspace fact out of it', () => {
    // Base64url of a two-field object, nothing more. Asserted so nobody later
    // "helpfully" packs a licence id or a row count into it.
    const encoded = encodeExportCursor({ createdAt: '2026-08-15T09:00:00.000Z', id: 'abc' });
    expect(encoded).not.toMatch(/[+/=]/);
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))).toEqual({
      v: 1,
      d: 'fwd',
      at: '2026-08-15T09:00:00.000Z',
      id: 'abc',
    });
  });

  it('refuses a cursor from the paged read surface', () => {
    // The single most dangerous confusion available here. The list endpoint's
    // cursor has the same two fields and runs the *other* way: taken at face
    // value it would be read as "everything after X" instead of "everything
    // before X", and the export would skip the whole history before X with
    // nothing looking wrong.
    const listCursor = Buffer.from(
      JSON.stringify({ createdAt: '2026-08-15T09:00:00.000Z', id: 'abc' }),
      'utf8',
    ).toString('base64url');

    expect(decodeExportCursor(listCursor)).toBeNull();
  });

  it('refuses junk rather than guessing a position', () => {
    for (const value of [
      'not-base64!!',
      Buffer.from('null', 'utf8').toString('base64url'),
      Buffer.from('"a string"', 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ v: 2, d: 'fwd', at: 'x', id: 'y' }), 'utf8').toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ v: 1, d: 'rev', at: 'x', id: 'y' }), 'utf8').toString(
        'base64url',
      ),
      Buffer.from(JSON.stringify({ v: 1, d: 'fwd', id: 'y' }), 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ v: 1, d: 'fwd', at: 12345, id: 'y' }), 'utf8').toString(
        'base64url',
      ),
    ]) {
      expect(decodeExportCursor(value), value).toBeNull();
    }
  });

  it('refuses a well-formed cursor whose timestamp is not a date', () => {
    // Left alone this becomes an `Invalid Date` in the keyset predicate, which
    // matches nothing — an empty export that reads as "caught up" rather than
    // as a broken cursor. That is the failure mode worth a test of its own.
    const cursor = Buffer.from(
      JSON.stringify({ v: 1, d: 'fwd', at: 'yesterday', id: 'abc' }),
      'utf8',
    ).toString('base64url');

    expect(decodeExportCursor(cursor)).toBeNull();
  });
});

describe('page size', () => {
  it('matches the figures the contract publishes', () => {
    // `paths/audit-log.yaml` tells callers "defaults to 1000, maximum 5000".
    // A consumer sizes its polling loop on those numbers, so they are pinned
    // here rather than left to drift out of step with the prose.
    expect(AUDIT_EXPORT_LIMITS).toEqual({ default: 1_000, max: 5_000 });
  });
});

describe('export horizon', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('stops short of the present by the configured margin', () => {
    expect(exportHorizon(now, 10_000).toISOString()).toBe('2026-08-15T11:59:50.000Z');
  });

  it('reads right up to now when the margin is zero', () => {
    expect(exportHorizon(now, 0)).toEqual(now);
  });

  it('never reads into the future, whatever it is handed', () => {
    // A negative margin would push the horizon past `now` and start exporting
    // rows that transactions in flight can still land behind — the exact skip
    // the horizon exists to prevent, arrived at by configuration.
    expect(exportHorizon(now, -60_000)).toEqual(now);
  });
});

describe('export record', () => {
  it('carries the workspace id as a string', () => {
    // The licence id is a 64-bit integer and JSON numbers are doubles. A SIEM
    // indexing several workspaces keys on this field.
    expect(toRecord(row()).license_id).toBe('42');
  });

  it('keeps the trail entry as stored, nulls included', () => {
    expect(
      toRecord(row({ target: 'account:abc', metadata: { from: 'agent', to: 'admin' } })),
    ).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      license_id: '42',
      action: 'auth.login',
      actor_id: '22222222-2222-4222-8222-222222222222',
      actor_type: 'agent',
      target: 'account:abc',
      metadata: { from: 'agent', to: 'admin' },
      ip: null,
      created_at: '2026-08-15T09:00:00.000Z',
      chain_seq: 7,
      prev_hash: 'prev',
      hash: 'own',
    });
  });

  it('carries the chain position as a number, not a string', () => {
    // Deliberately unlike `license_id`. Continuity means `n + 1`, so a consumer
    // does arithmetic on this field, and a per-workspace entry counter cannot
    // reach the 2^53 where a JSON number would stop being exact.
    expect(toRecord(row()).chain_seq).toBe(7);
  });

  it('says so plainly when an entry predates the chain', () => {
    // Nullable on purpose: entries written before C6-c cannot be back-computed
    // without the key, and inventing hashes for them would forge exactly the
    // assurance the chain exists to give.
    const record = toRecord(row({ chainSeq: null, prevHash: null, hash: null }));
    expect(record.chain_seq).toBeNull();
    expect(record.hash).toBeNull();
  });
});

describe('NDJSON serialisation', () => {
  const records = [toRecord(row()), toRecord(row({ id: 'second', action: 'auth.logout' }))];

  it('writes one complete object per line', () => {
    const lines = toNdjson(records).split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow();
    expect((JSON.parse(lines[1]!) as AuditExportRecord).action).toBe('auth.logout');
  });

  it('terminates the last line too, so pages concatenate', () => {
    // Without this, a consumer appending the next page to a file splices two
    // records into one unparseable line at the seam.
    const joined = toNdjson(records) + toNdjson(records);
    expect(joined.split('\n').filter(Boolean)).toHaveLength(4);
  });

  it('is empty, not a blank line, for an empty page', () => {
    expect(toNdjson([])).toBe('');
  });

  it('does not let a newline inside a value break the framing', () => {
    // `JSON.stringify` escapes it, but the framing depends on that being true,
    // so it is pinned rather than assumed: a target or metadata value carrying
    // a newline would otherwise split one record into two half-records.
    const body = toNdjson([toRecord(row({ target: 'note:line1\nline2' }))]);
    expect(body.split('\n').filter(Boolean)).toHaveLength(1);
    expect((JSON.parse(body) as AuditExportRecord).target).toBe('note:line1\nline2');
  });
});
