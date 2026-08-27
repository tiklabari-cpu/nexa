/**
 * `.env` loading, and the 12-factor promise underneath it (M-PROD-CFG-a).
 *
 * A production deployment gets its configuration from the process environment
 * and from nowhere else — there is no `.env` file in a container image, and a
 * process that quietly needed one would fail at boot in the one place nobody
 * can attach a shell to. That is true today: `loadEnvFile` is a convenience for
 * whoever runs a script outside `make dev`, it returns immediately when the file
 * is absent, and a value already in the environment always wins.
 *
 * True by accident is not the same as true on purpose, which is what this file
 * is for. The failure it guards against is small and plausible: someone adds
 * `dotenv` to make a script easier to run, `dotenv.config()` is silent about a
 * missing file too, and six months later a deployment depends on a file that
 * only exists on developer machines.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// src/config → apps/api → apps → repo root (the resolution the loader itself uses)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * A loader with its own `loaded` flag.
 *
 * The module guards against running twice, and `test/setup.ts` has already spent
 * that one run before this file is evaluated. Re-importing after a reset is what
 * makes the assertions below mean anything rather than pass against a no-op —
 * and if the reset ever stopped working, the "a file value fills a gap" case
 * fails rather than going quietly green.
 */
async function freshLoader(): Promise<(fromDir?: string) => void> {
  vi.resetModules();
  const module = await import('./load-env-file.js');
  return module.loadEnvFile;
}

/** A `<root>/w/x/y/z` directory to call the loader from — it resolves four levels up. */
function envFileFixture(contents?: string): { root: string; fromDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'nexa-load-env-'));
  const fromDir = join(root, 'w', 'x', 'y', 'z');
  mkdirSync(fromDir, { recursive: true });
  if (contents !== undefined) writeFileSync(join(root, '.env'), contents, 'utf8');
  return { root, fromDir };
}

const TEST_KEYS = ['NEXA_LOAD_ENV_ALREADY_SET', 'NEXA_LOAD_ENV_FROM_FILE'] as const;
const created: string[] = [];

afterEach(() => {
  for (const key of TEST_KEYS) delete process.env[key];
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('loadEnvFile', () => {
  it('does nothing at all when there is no .env to read', async () => {
    const { root, fromDir } = envFileFixture();
    created.push(root);
    const before = { ...process.env };

    const loadEnvFile = await freshLoader();

    expect(() => loadEnvFile(fromDir)).not.toThrow();
    // Not "does not throw" — does not *change anything*. A deployment whose
    // configuration came entirely from its orchestrator has to see the same
    // environment after this call as before it.
    expect({ ...process.env }).toEqual(before);
  });

  it('fills a gap from the file but never overwrites what the environment already said', async () => {
    const { root, fromDir } = envFileFixture(
      [
        '# a comment, and a blank line below',
        '',
        'NEXA_LOAD_ENV_ALREADY_SET=from-file',
        'NEXA_LOAD_ENV_FROM_FILE="from-file"',
      ].join('\n'),
    );
    created.push(root);
    process.env['NEXA_LOAD_ENV_ALREADY_SET'] = 'from-the-shell';

    const loadEnvFile = await freshLoader();
    loadEnvFile(fromDir);

    // The precedence that makes the file safe to keep: CI, `docker compose` and
    // a developer's own shell all override it rather than fight it.
    expect(process.env['NEXA_LOAD_ENV_ALREADY_SET']).toBe('from-the-shell');
    expect(process.env['NEXA_LOAD_ENV_FROM_FILE']).toBe('from-file');
  });
});

/** Every workspace manifest — the root plus whatever `pnpm-workspace.yaml` globs in. */
function manifests(): Array<{ path: string; json: Record<string, unknown> }> {
  const dirs = ['.'];
  for (const group of ['apps', 'packages']) {
    const groupPath = resolve(REPO_ROOT, group);
    if (!existsSync(groupPath)) continue;
    for (const entry of readdirSync(groupPath)) dirs.push(`${group}/${entry}`);
  }

  return dirs
    .map((dir) => ({ dir, file: resolve(REPO_ROOT, dir, 'package.json') }))
    .filter(({ file }) => existsSync(file))
    .map(({ dir, file }) => ({
      path: `${dir}/package.json`,
      json: JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>,
    }));
}

describe('12-factor configuration', () => {
  it('reads a plausible number of manifests (a broken glob must not pass vacuously)', () => {
    expect(manifests().length).toBeGreaterThan(5);
  });

  it('depends on no .env-file library, in any workspace', () => {
    // pnpm links only declared dependencies, so a manifest that does not name
    // `dotenv` describes a package that cannot import it — this is the lock
    // itself, not a proxy for one. A list rather than one name because the next
    // one reached for would be `dotenv-flow` or `@dotenvx/dotenvx`.
    const banned = ['dotenv', 'dotenv-flow', 'dotenv-expand', '@dotenvx/dotenvx'];
    const offenders: string[] = [];

    for (const { path, json } of manifests()) {
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const deps = (json[field] ?? {}) as Record<string, string>;
        for (const name of banned) {
          if (name in deps) offenders.push(`${path} → ${field}.${name}`);
        }
      }
    }

    expect(
      offenders,
      `an .env file must never become a boot dependency: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
