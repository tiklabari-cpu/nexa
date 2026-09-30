// @vitest-environment node
/**
 * The widget image ships no source maps; every other build keeps them (tm 256.5).
 *
 * Same rule as the panel (`apps/web/test/build-sourcemaps.test.ts`), for both
 * of the widget's build passes: `vite.config.ts` reads one variable, and the
 * Dockerfile sets it before the build and then refuses an output that still
 * carries a map.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserConfig, UserConfigFnObject } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import configFn from '../vite.config';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sourcemapWith(value: string | undefined, mode: string): unknown {
  vi.stubEnv('SIYAHTUS_BUILD_SOURCEMAPS', value);
  const config: UserConfig = (configFn as UserConfigFnObject)({ command: 'build', mode });
  return config.build?.sourcemap;
}

describe('widget build source maps (tm 256.5)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['loader', 'production'])('keeps them for a local %s build', (mode) => {
    expect(sourcemapWith(undefined, mode)).toBe(true);
  });

  it.each(['loader', 'production'])(
    'drops them from the %s pass when SIYAHTUS_BUILD_SOURCEMAPS=false',
    (mode) => {
      expect(sourcemapWith('false', mode)).toBe(false);
    },
  );

  it('the Dockerfile turns them off before the build and refuses a map after it', () => {
    const dockerfile = readFileSync(resolve(APP_ROOT, 'Dockerfile'), 'utf8');
    const off = dockerfile.indexOf('ENV SIYAHTUS_BUILD_SOURCEMAPS=false');
    const build = dockerfile.indexOf('run build');
    expect(off).toBeGreaterThan(0);
    expect(build).toBeGreaterThan(off);
    const guard = dockerfile.slice(build);
    expect(guard).toContain("find apps/widget/dist -name '*.map'");
    expect(guard).toContain("grep -rlq 'sourceMappingURL=' apps/widget/dist");
    expect(guard).toMatch(/exit 1;/);
  });
});
