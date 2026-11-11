// node --test scripts/audit/dependency-audit.test.mjs — kapıda `statik › loop-tools` adımı.
// Ağ yok: `pnpm audit --json` çıktısının biçimini taklit eden fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyze, formatSummary, rootOf } from './dependency-audit.mjs';

const SCRIPT = fileURLToPath(new URL('./dependency-audit.mjs', import.meta.url));

function advisory(id, ghsa, module, severity, roots) {
  return {
    id,
    github_advisory_id: ghsa,
    module_name: module,
    severity,
    title: `${module} advisory`,
    vulnerable_versions: '<1.0.0',
    patched_versions: '>=1.0.0',
    findings: [{ version: '0.9.0', paths: roots.map((r) => `apps__${r}>dep>${module}`) }],
  };
}

const audit = {
  advisories: {
    1: advisory(1, 'GHSA-aaaa-aaaa-aaaa', 'left-pad', 'high', ['api']),
    2: advisory(2, 'GHSA-bbbb-bbbb-bbbb', 'mobile-only', 'critical', ['mobile']),
    3: advisory(3, 'GHSA-cccc-cccc-cccc', 'moderate-one', 'moderate', ['api']),
    4: advisory(4, 'GHSA-dddd-dddd-dddd', 'allowed-one', 'high', ['api', 'rtm', 'mobile']),
  },
};
const NOW = new Date('2026-11-11T00:00:00Z');
const entry = (ghsa, expires, reason = 'because') => ({ ghsa, reason, expires });

describe('rootOf', () => {
  test('apps__ öneki atılır', () => {
    assert.equal(rootOf('apps__api>fastify>fast-uri'), 'api');
    assert.equal(rootOf('packages__x>y'), 'packages__x');
  });
});

describe('analyze', () => {
  test('sunucu yolunda izinsiz high → bulgu; mobil-yalnız ve moderate → yok sayılır', () => {
    const r = analyze(audit, { entries: [] }, { now: NOW });
    assert.deepEqual(r.findings.map((f) => f.ghsa).sort(), [
      'GHSA-aaaa-aaaa-aaaa',
      'GHSA-dddd-dddd-dddd',
    ]);
    assert.deepEqual(r.findings.find((f) => f.module === 'allowed-one').roots, ['api', 'rtm']);
  });

  test('izin listesindeki → allowed, bulgu değil', () => {
    const r = analyze(
      audit,
      { entries: [entry('GHSA-dddd-dddd-dddd', '2026-12-31')] },
      { now: NOW },
    );
    assert.deepEqual(
      r.findings.map((f) => f.ghsa),
      ['GHSA-aaaa-aaaa-aaaa'],
    );
    assert.equal(r.allowed.length, 1);
    assert.equal(r.allowed[0].reason, 'because');
    assert.deepEqual(r.stale, []);
  });

  test('süresi geçmiş izin → bulgu geri gelir ve expired listelenir', () => {
    const r = analyze(
      audit,
      { entries: [entry('GHSA-dddd-dddd-dddd', '2026-11-10')] },
      { now: NOW },
    );
    assert.ok(r.findings.some((f) => f.ghsa === 'GHSA-dddd-dddd-dddd'));
    assert.deepEqual(
      r.expired.map((e) => e.ghsa),
      ['GHSA-dddd-dddd-dddd'],
    );
    assert.equal(r.allowed.length, 0);
  });

  test('son gün dahil geçerli', () => {
    const r = analyze(
      audit,
      { entries: [entry('GHSA-dddd-dddd-dddd', '2026-11-11')] },
      { now: NOW },
    );
    assert.equal(r.allowed.length, 1);
  });

  test('hiçbir şeyle eşleşmeyen izin → stale', () => {
    const r = analyze(
      audit,
      { entries: [entry('GHSA-eeee-eeee-eeee', '2026-12-31')] },
      { now: NOW },
    );
    assert.deepEqual(
      r.stale.map((e) => e.ghsa),
      ['GHSA-eeee-eeee-eeee'],
    );
  });

  test('mobil-yalnız bir advisory için izin → stale (sunucu yolunda eşleşme yok)', () => {
    const r = analyze(
      audit,
      { entries: [entry('GHSA-bbbb-bbbb-bbbb', '2026-12-31')] },
      { now: NOW },
    );
    assert.equal(r.stale.length, 1);
  });

  test('gerekçesiz / tarihsiz / bozuk kimlikli izin → problems, sessizce izin vermez', () => {
    const r = analyze(
      audit,
      {
        entries: [
          { ghsa: 'GHSA-dddd-dddd-dddd', expires: '2026-12-31' },
          { ghsa: 'GHSA-dddd-dddd-dddd', reason: 'x', expires: 'soon' },
          { ghsa: 'dddd', reason: 'x', expires: '2026-12-31' },
        ],
      },
      { now: NOW },
    );
    assert.equal(r.problems.length, 3);
    assert.ok(r.findings.some((f) => f.ghsa === 'GHSA-dddd-dddd-dddd'));
  });

  test('aynı GHSA birden çok aralıkta → bir kez raporlanır', () => {
    const twice = {
      advisories: {
        1: advisory(1, 'GHSA-aaaa-aaaa-aaaa', 'left-pad', 'high', ['api']),
        2: advisory(2, 'GHSA-aaaa-aaaa-aaaa', 'left-pad', 'high', ['api']),
      },
    };
    assert.equal(analyze(twice, { entries: [] }, { now: NOW }).findings.length, 1);
  });

  test('özet: uyarı modunda ipucu, strict’te yok', () => {
    const r = analyze(audit, { entries: [] }, { now: NOW });
    assert.match(formatSummary(r, { strict: false }), /warn mode: exit 0/);
    assert.doesNotMatch(formatSummary(r, { strict: true }), /warn mode/);
  });
});

describe('CLI (fixture dosyası, ağsız)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dep-audit-'));
  const input = join(dir, 'audit.json');
  const allow = join(dir, 'allow.json');
  writeFileSync(input, JSON.stringify(audit));
  writeFileSync(allow, JSON.stringify({ entries: [] }));
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, '--input', input, '--allowlist', allow, ...args], {
      encoding: 'utf8',
    });

  test('uyarı modu: izinsiz high olsa da exit 0 + özet', () => {
    const r = run();
    assert.equal(r.status, 0);
    assert.match(r.stdout, /2 not allowlisted/);
    assert.match(r.stdout, /GHSA-aaaa-aaaa-aaaa/);
  });

  test('--strict: izinsiz high → exit 1', () => {
    assert.equal(run('--strict').status, 1);
  });

  test('--strict: her şey izinli → exit 0', () => {
    writeFileSync(
      allow,
      JSON.stringify({
        entries: [
          entry('GHSA-aaaa-aaaa-aaaa', '2999-01-01'),
          entry('GHSA-dddd-dddd-dddd', '2999-01-01'),
        ],
      }),
    );
    const r = run('--strict');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /0 not allowlisted, 2 allowlisted/);
    rmSync(dir, { recursive: true, force: true });
  });
});
