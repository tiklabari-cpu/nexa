/**
 * Pins the one coupling tm 164.3's migration decision rests on.
 *
 * The decision (CONVENTIONS §6) is split across two files that no compiler,
 * type or import connects: `apps/api/docker-entrypoint.sh` skips its inline
 * `prisma migrate deploy` when `NEXA_MIGRATE_ON_START` is `false`, and the Helm
 * chart's ConfigMap is what sets it — while a hook Job migrates instead. Delete
 * either half and nothing fails to build, nothing fails to render, and the
 * deployment quietly goes back to every replica racing to migrate on start.
 * That race is not a data problem (measured: each migration still applies
 * exactly once) but a liveness one — Prisma waits only 10 s for the advisory
 * lock and then exits 1, which in an entrypoint means the pod crash-loops.
 *
 * So the halves are checked against each other here, as text: the same
 * technique `env.parity.test.ts` uses on `.env.example`/`turbo.json`, and for
 * the same reason — the files are real, the connection between them is not.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// src/config → apps/api → apps → repo root (same resolution as load-env-file.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path: string): string => readFileSync(resolve(REPO_ROOT, path), 'utf8');

const ENTRYPOINT = 'apps/api/docker-entrypoint.sh';
const CHART_VALUES = 'infra/helm/nexa/values.yaml';
const MIGRATE_JOB = 'infra/helm/nexa/templates/migrate-job.yaml';
const FLAG = 'NEXA_MIGRATE_ON_START';

describe(`migration strategy: ${ENTRYPOINT} ↔ Helm chart (tm 164.3, CONVENTIONS §6)`, () => {
  it('the entrypoint gates its migrate step on the flag, defaulting to migrating', () => {
    const entrypoint = read(ENTRYPOINT);
    // The default has to stay "migrate": docker-compose.full.yml and every
    // `docker run` of this image rely on it, and only a multi-replica
    // deployment has a reason (or the configuration) to opt out.
    expect(entrypoint).toMatch(new RegExp(`\\$\\{${FLAG}:-true\\}`));
    expect(entrypoint).toContain('npx prisma migrate deploy');
  });

  it('skips only on the exact string the ConfigMap renders, not a truthy guess', () => {
    const entrypoint = read(ENTRYPOINT);
    const comparison = new RegExp(`\\[ "\\$\\{${FLAG}:-true\\}" = "false" \\]`);
    expect(
      comparison.test(entrypoint),
      'the entrypoint must compare against the literal "false" a ConfigMap value renders as',
    ).toBe(true);
  });

  it('the chart turns the inline step off, quoted so it stays a string', () => {
    const values = read(CHART_VALUES);
    const configured = new RegExp(`^\\s{2}${FLAG}:\\s*"false"\\s*$`, 'm');
    expect(
      configured.test(values),
      `${CHART_VALUES} must set ${FLAG}: "false" under config — otherwise every api pod migrates on start`,
    ).toBe(true);
  });

  it('a Job migrates instead, as a pre-install/pre-upgrade hook', () => {
    const job = read(MIGRATE_JOB);
    expect(job).toContain('kind: Job');
    expect(job).toMatch(/"helm\.sh\/hook":\s*pre-install,pre-upgrade/);
    expect(job).toContain('migrate');
    expect(job).toContain('deploy');
  });

  it('the Job migrates and does NOT seed', () => {
    // The local stack's `init` service runs migrate *and* the seed
    // (docker-compose.full.yml); a deployment's database is not a demo, and the
    // seed writes fixture organisations, agents and chats over real data.
    const uncommented = read(MIGRATE_JOB)
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(uncommented).not.toMatch(/seed/i);
  });
});
