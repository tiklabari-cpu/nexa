/**
 * `SIEM_PROVIDER` selects a destination (M-PROV-a · §D113/K3 · NFR-C6 · C6-d).
 *
 * The file writing moved out of `siem-sink.ts`, which keeps the *when* and the
 * cursor. What moved with it is half of that module's order invariant: `deliver`
 * may only resolve once the bytes are durably down, because the sink advances
 * the cursor on a resolve and rolls back on a throw — so a resolve that ran
 * ahead of the write would let a crash turn undelivered records into records the
 * retention rule believes were shipped. The cases below check both directions of
 * that: what a resolve guarantees, and that a destination it cannot write to
 * throws rather than reporting success.
 *
 * The sink's own behaviour around this — the lock, the rollback, the cursor that
 * does not move — stays proven in `test/integration/siem-sink.test.ts`.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSiemTarget, FileSiemTarget, SIEM_PROVIDERS, type SiemBatch } from './siem-target.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function batch(overrides: Partial<SiemBatch> = {}): SiemBatch {
  return {
    licenseId: 7n,
    now: NOW,
    body: '{"id":"a"}\n{"id":"b"}\n',
    signature: 'sha256=deadbeef',
    ...overrides,
  };
}

describe('createSiemTarget', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-siem-factory-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('gives "file" a target that writes under SIEM_DIR', async () => {
    const target = createSiemTarget('file', { siemDir: dir });
    expect(target).toBeInstanceOf(FileSiemTarget);
    expect(target.name).toBe('file');

    const path = await target.deliver(batch());

    // Resolved, so the bytes are already down — both files, readable now, with
    // no further await. That is the guarantee the sink's cursor rests on.
    expect(await readFile(path, 'utf8')).toBe('{"id":"a"}\n{"id":"b"}\n');
    expect(await readFile(`${path}.sig`, 'utf8')).toBe('sha256=deadbeef');
  });

  it('partitions by licence, so one workspace cannot read another out of the spool', async () => {
    const target = createSiemTarget('file', { siemDir: dir });
    await target.deliver(batch({ licenseId: 7n }));
    await target.deliver(batch({ licenseId: 8n }));

    expect((await readdir(dir)).sort()).toEqual(['7', '8']);
    expect((await readdir(join(dir, '7'))).filter((n) => n.endsWith('.ndjson'))).toHaveLength(1);
  });

  it('keeps two deliveries in the same millisecond apart', async () => {
    // Concurrent sweeps and fast retries both land on the same timestamp; the
    // random suffix is what stops the second from overwriting the first — a
    // silent loss of an audit page nobody would notice.
    const target = createSiemTarget('file', { siemDir: dir });
    const [first, second] = await Promise.all([target.deliver(batch()), target.deliver(batch())]);

    expect(first).not.toBe(second);
    expect((await readdir(join(dir, '7'))).filter((n) => n.endsWith('.ndjson'))).toHaveLength(2);
  });

  it('throws rather than reporting a delivery it could not make', async () => {
    // A path that cannot become a directory (a file sits where the root would
    // go). The sink turns this throw into a rolled-back transaction and a
    // `failed` line; a resolve here would advance the cursor over rows that
    // never left the process.
    const blocked = join(dir, 'not-a-directory');
    await createSiemTarget('file', { siemDir: dir }).deliver(batch({ licenseId: 1n }));
    await writeFile(blocked, 'occupied', 'utf8');

    await expect(
      createSiemTarget('file', { siemDir: blocked }).deliver(batch()),
    ).rejects.toBeInstanceOf(Error);
  });

  it('has an implementation for every value the vocabulary allows', () => {
    for (const provider of SIEM_PROVIDERS) {
      expect(createSiemTarget(provider, { siemDir: dir }).name).toBe(provider);
    }
    expect(SIEM_PROVIDERS).toEqual(['file']);
  });
});
