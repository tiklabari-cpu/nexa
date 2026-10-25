// @vitest-environment node
/**
 * The admin image ships no source maps; every other build keeps them (apps/web, tm 256.5).
 *
 * A `.map` served from `/assets/` is the panel's original TypeScript, comments included.
 * `vite.config.ts` reads one variable, and the Dockerfile sets it before the build and then
 * refuses an output that still carries a map. Both halves are pinned here: the config's
 * answer to the variable, and the Dockerfile's order (the variable has to be set before
 * `vite build`, or the switch is decoration).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function sourcemapWith(value: string | undefined): Promise<unknown> {
  vi.stubEnv('SIYAHTUS_BUILD_SOURCEMAPS', value);
  vi.resetModules();
  const { default: config } = await import('../vite.config');
  return (config as { build?: { sourcemap?: unknown } }).build?.sourcemap;
}

describe('admin build source maps', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps them for a local build', async () => {
    expect(await sourcemapWith(undefined)).toBe(true);
  });

  it('drops them when SIYAHTUS_BUILD_SOURCEMAPS=false', async () => {
    expect(await sourcemapWith('false')).toBe(false);
  });

  it('reads only `false` as off', async () => {
    expect(await sourcemapWith('0')).toBe(true);
  });

  it('the Dockerfile turns them off before the build and refuses a map after it', () => {
    const dockerfile = readFileSync(resolve(APP_ROOT, 'Dockerfile'), 'utf8');
    const off = dockerfile.indexOf('ENV SIYAHTUS_BUILD_SOURCEMAPS=false');
    const build = dockerfile.indexOf('run build');
    expect(off).toBeGreaterThan(0);
    expect(build).toBeGreaterThan(off);
    const guard = dockerfile.slice(build);
    expect(guard).toContain("find apps/admin/dist -name '*.map'");
    expect(guard).toContain("grep -rlq 'sourceMappingURL=' apps/admin/dist");
    expect(guard).toMatch(/exit 1;/);
  });
});
