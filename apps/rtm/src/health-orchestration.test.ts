/**
 * What reads the health routes in the shipped stacks (tm 454).
 *
 * Two properties the health changes rely on and nothing else would notice
 * breaking:
 *
 * - **Status code only.** Every orchestrator check (the api/rtm Docker
 *   HEALTHCHECKs that compose's `service_healthy` waits on, compose's own
 *   platform-api healthcheck, Helm's probes) reads the status code — `curl -f`
 *   or `httpGet` — never the body. The body is `{status, service}` for every
 *   caller since F35; a check that grepped a field out of it would break
 *   silently the next time the body changes.
 * - **Slower than the probe cache.** `/health` and `/health/ready` reuse one
 *   dependency probe for {@link HEALTH_PROBE_TTL_MS} (F34). Every check here
 *   runs at a longer interval, so no orchestrator reads a result older than
 *   the one its own previous request produced.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEALTH_PROBE_TTL_MS } from './health-probe.js';

// src → apps/rtm → apps → repo root
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path: string): string => readFileSync(resolve(REPO_ROOT, path), 'utf8');

/** `curl -fsS "<url>/health/ready" || exit 1` — `-f` makes the status the whole verdict. */
const STATUS_ONLY_CURL = /^curl -fsS "?https?:\/\/[^\s"]+\/health\/(ready|live)"? \|\| exit 1$/;

describe('Docker HEALTHCHECKs of api and rtm (compose waits on these)', () => {
  for (const app of ['api', 'rtm']) {
    it(`apps/${app}/Dockerfile probes readiness by status code, slower than the probe cache`, () => {
      const dockerfile = read(`apps/${app}/Dockerfile`);
      const match = /HEALTHCHECK --interval=(\d+)s[^\n]*\\\r?\n\s*CMD (.+)/.exec(dockerfile);
      expect(match, `apps/${app}/Dockerfile has a HEALTHCHECK`).not.toBeNull();
      const [, interval, command] = match!;

      expect(command!.trim()).toMatch(STATUS_ONLY_CURL);
      expect(command).toContain('/health/ready');
      expect(Number(interval) * 1000).toBeGreaterThan(HEALTH_PROBE_TTL_MS);
    });
  }
});

describe('compose healthchecks that call a health route', () => {
  for (const file of [
    'docker-compose.yml',
    'docker-compose.full.yml',
    'docker-compose.pilot.yml',
  ]) {
    it(`${file}: status code only, interval longer than the probe cache`, () => {
      const lines = read(file).split(/\r?\n/);
      let seen = 0;
      lines.forEach((line, index) => {
        if (!/^\s*test:/.test(line) || !line.includes('/health')) return;
        seen += 1;
        const command = /'CMD-SHELL', '(.+)'\]/.exec(line)?.[1];
        expect(command, `${file}:${index + 1}`).toBeDefined();
        expect(command!).toMatch(STATUS_ONLY_CURL);

        const interval = lines
          .slice(index + 1, index + 4)
          .map((next) => /^\s*interval: (\d+)s/.exec(next)?.[1])
          .find((value) => value !== undefined);
        expect(interval, `${file}:${index + 1} sets an interval`).toBeDefined();
        expect(Number(interval) * 1000).toBeGreaterThan(HEALTH_PROBE_TTL_MS);
      });
      // docker-compose.yml runs only the datastores; the other two check platform-api.
      if (file !== 'docker-compose.yml') expect(seen).toBeGreaterThan(0);
    });
  }
});

describe('Helm probes', () => {
  it('are httpGet (status code only) against the health routes, every period longer than the probe cache', () => {
    const template = read('infra/helm/siyahtus/templates/deployment.yaml');
    for (const probe of ['startupProbe', 'livenessProbe', 'readinessProbe']) {
      const block = new RegExp(`${probe}:\\r?\\n\\s+httpGet:`).exec(template);
      expect(block, `${probe} is an httpGet`).not.toBeNull();
    }
    expect(template).not.toMatch(/^\s+exec:/m);

    const periods = [...template.matchAll(/periodSeconds: (\d+)/g)].map((m) => Number(m[1]));
    expect(periods.length).toBeGreaterThanOrEqual(3);
    for (const period of periods) expect(period * 1000).toBeGreaterThan(HEALTH_PROBE_TTL_MS);

    const values = read('infra/helm/siyahtus/values.yaml');
    expect(values).toContain('readiness: /api/v1/health/ready');
    expect(values).toContain('readiness: /health/ready');
  });
});
