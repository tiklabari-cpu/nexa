import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AI_TEMPLATES_PACKAGE_VERSION, IGAMING_CORE_PACK } from './index.js';

const SRC = dirname(fileURLToPath(import.meta.url));

describe('the package', () => {
  it('the pack carries the package’s version', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(AI_TEMPLATES_PACKAGE_VERSION).toBe(pkg.version);
    expect(IGAMING_CORE_PACK.version).toBe(pkg.version);
  });

  /**
   * The API image ships this package's `dist/` without a `node_modules` of its
   * own (`apps/api/Dockerfile`), so nothing the entry point loads may import a
   * value from another package — a type import is erased. `validate.ts` is
   * outside the entry point's graph.
   */
  it('the entry point’s graph imports only types from other packages', () => {
    const IMPORT = /^(import|export)\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)';/gm;
    const seen = new Set<string>();
    const values: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const [, , typeOnly, names, from] of source.matchAll(IMPORT)) {
        if (from!.startsWith('.')) {
          visit(resolve(dirname(file), from!.replace(/\.js$/, '.ts')));
        } else if (typeOnly === undefined && !/^\{\s*(type\s+[\w$]+\s*,?\s*)+\}$/.test(names!)) {
          values.push(`${file.slice(SRC.length + 1)}: ${from}`);
        }
      }
    };
    visit(join(SRC, 'index.ts'));
    // Every source file but the validator and the tests: the catalogue and each template.
    const igaming = readdirSync(join(SRC, 'igaming'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => `igaming/${file}`);
    expect([...seen].map((file) => file.slice(SRC.length + 1).replace(/\\/g, '/')).sort()).toEqual(
      ['catalogue.ts', 'index.ts', ...igaming].sort(),
    );
    expect(values).toEqual([]);
  });
});
