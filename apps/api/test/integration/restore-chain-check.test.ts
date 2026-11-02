/**
 * The platform audit chain, verified in a restored database (tm 392 ·
 * NFR-ADMIN-B · scripts/restore-drill.sh). The drill hands the scratch
 * database to `checkRestoredChain`; this pins the four verdicts it reads off —
 * on a real chain, edited as its owner the way a bad restore (or an attacker)
 * would leave it.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  checkRestoredChain,
  describeOutcome,
  parseChainDump,
  RESTORE_CHAIN_EXIT,
} from '../../src/services/platform/restore-chain-check.js';
import { PlatformAuditLog } from '../../src/services/platform/platform-audit.js';
import { ownerClient, resetDatabase, testEnv } from '../helpers/fixtures.js';
import { platformSettingsKey } from '../helpers/platform-admin.js';

const owner = ownerClient();
const KEY = platformSettingsKey();

afterAll(async () => {
  await owner.$disconnect();
});

async function record(count: number): Promise<void> {
  const log = new PlatformAuditLog(owner, {
    settingsKey: KEY,
    tenantChainSecret: testEnv().AUDIT_CHAIN_SECRET,
  });
  for (let i = 1; i <= count; i += 1) {
    await log.record({
      adminId: null,
      action: 'admin.signed_out',
      targetType: 'session',
      targetId: `s${i}`,
    });
  }
}

/**
 * What scripts/restore-drill.sh pipes in: the head line, then the entries as the
 * audit export writes them — here by the real exporter, so the format the
 * drill's SQL imitates is pinned against the one it imitates.
 */
async function dump(): Promise<string> {
  const log = new PlatformAuditLog(owner, {
    settingsKey: KEY,
    tenantChainSecret: testEnv().AUDIT_CHAIN_SECRET,
  });
  const head = await owner.platformAuditChainHead.findUnique({ where: { id: 1 } });
  const page = await log.exportPage({ limit: 5000 });
  const headLine = head ? JSON.stringify({ seq: head.seq.toString(), hash: head.hash }) : 'null';
  return [headLine, page.body].join('\n');
}

const check = async (key: string | undefined) =>
  checkRestoredChain(parseChainDump(await dump()), key);

/** Edit the append-only table as its owner — what a restore of a doctored dump looks like. */
async function tamper(sql: string): Promise<void> {
  await owner.$transaction([
    owner.$executeRawUnsafe(
      'ALTER TABLE platform_audit_log DISABLE TRIGGER platform_audit_log_append_only',
    ),
    owner.$executeRawUnsafe(sql),
    owner.$executeRawUnsafe(
      'ALTER TABLE platform_audit_log ENABLE TRIGGER platform_audit_log_append_only',
    ),
  ]);
}

describe('the platform chain check the restore drill runs (tm 392)', () => {
  beforeEach(async () => {
    await resetDatabase(owner);
  });

  it('(a) says "skipped", not "verified", when there is no key to derive the chain key from', async () => {
    await record(2);
    for (const key of [undefined, '']) {
      const outcome = await check(key);
      expect(outcome.kind).toBe('skipped');
      expect(describeOutcome(outcome)[0]).toContain('skipped');
    }
  });

  it('(b) says "not exercised" for an empty trail — nothing was verified, so nothing is proven', async () => {
    const outcome = await check(KEY);
    expect(outcome.kind).toBe('empty');
    expect(describeOutcome(outcome)).toEqual([
      'platform chain not exercised: platform_audit_log holds no entries',
    ]);
  });

  it('(c) verifies an intact chain from position 1 to the head', async () => {
    await record(5);
    const outcome = await check(KEY);
    expect(outcome).toMatchObject({
      kind: 'verified',
      verification: { checked: 5, first_seq: '1', last_seq: '5', head_seq: '5' },
    });
    expect(describeOutcome(outcome)[0]).toBe(
      'platform chain verified: 5 entries, positions 1..5, head at 5',
    );
  });

  it('(d) fails an altered entry and the entry linked onto it', async () => {
    await record(5);
    await tamper(
      `UPDATE platform_audit_log SET reason = 'edited after the fact' WHERE chain_seq = 3`,
    );
    const outcome = await check(KEY);
    expect(outcome.kind).toBe('broken');
    if (outcome.kind !== 'broken') return;
    expect(outcome.verification.findings.map((f) => [f.kind, f.seq])).toContainEqual([
      'hash_mismatch',
      '3',
    ]);
    expect(describeOutcome(outcome)[0]).toContain('BROKEN');
  });

  it('(e) fails a removed entry, and a removed tail the head still remembers', async () => {
    await record(5);
    await tamper('DELETE FROM platform_audit_log WHERE chain_seq = 2');
    const gap = await check(KEY);
    expect(gap.kind).toBe('broken');
    if (gap.kind === 'broken') {
      expect(gap.verification.findings.map((f) => f.kind)).toContain('sequence_gap');
    }

    await tamper('DELETE FROM platform_audit_log WHERE chain_seq = 5');
    const tail = await check(KEY);
    expect(tail.kind).toBe('broken');
    if (tail.kind === 'broken') {
      expect(tail.verification.findings.map((f) => f.kind)).toContain('head_mismatch');
    }
  });

  it('(f) fails a chain whose first entry is not position 1', async () => {
    await record(3);
    await tamper('DELETE FROM platform_audit_log WHERE chain_seq = 1');
    const outcome = await check(KEY);
    expect(outcome.kind).toBe('broken');
  });

  it('(g) the same chain under another key is not verified', async () => {
    await record(2);
    const outcome = await check(`${KEY}-not-the-key`);
    expect(outcome.kind).toBe('broken');
  });

  it('(h) refuses input that is not a dump, so the drill reports "could not run" and not a verdict', () => {
    expect(() => parseChainDump('')).toThrow(/empty/);
    expect(() => parseChainDump('not json')).toThrow();
    expect(() => parseChainDump('{"seq":"x"}')).toThrow(/seq/);
    expect(parseChainDump('null')).toEqual({ head: null, rows: [] });
  });

  it('(i) gives each verdict its own exit code, with 0 reserved for "verified"', () => {
    const codes = Object.values(RESTORE_CHAIN_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
    expect(RESTORE_CHAIN_EXIT.verified).toBe(0);
  });
});
