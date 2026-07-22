/**
 * NFR-P3: the widget must not slow down the customer's page.
 *
 * The budget is checked against the gzipped bytes actually served, and it is a
 * test rather than a note in a doc because bundle size regresses silently —
 * one careless import is all it takes.
 */
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const distDir = resolve(import.meta.dirname, '../dist');

/** Hard ceiling from the PRD. */
const TOTAL_BUDGET_BYTES = 50 * 1024;
/** The loader runs on the host page itself, so it gets a far tighter budget. */
const LOADER_BUDGET_BYTES = 8 * 1024;

function gzippedSize(path: string): number {
  return gzipSync(readFileSync(path), { level: 9 }).byteLength;
}

function collectAssets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectAssets(full);
    return /\.(js|css)$/.test(entry.name) ? [full] : [];
  });
}

describe.skipIf(!existsSync(distDir))('widget bundle budget', () => {
  it('keeps the host-page loader under 8 KB gzipped', () => {
    const loader = join(distDir, 'loader.js');
    expect(existsSync(loader), 'run `pnpm --filter @nexa/widget build` first').toBe(true);

    const size = gzippedSize(loader);
    expect(size, `loader.js is ${size} B gzipped`).toBeLessThanOrEqual(LOADER_BUDGET_BYTES);
  });

  it('keeps everything the browser downloads under 50 KB gzipped (NFR-P3)', () => {
    const assets = collectAssets(distDir);
    expect(assets.length).toBeGreaterThan(0);

    const total = assets.reduce((sum, file) => sum + gzippedSize(file), 0);
    const breakdown = assets
      .map((file) => `${file.replace(distDir, '')}: ${gzippedSize(file)} B`)
      .join('\n');

    expect(total, `total ${total} B gzipped\n${breakdown}`).toBeLessThanOrEqual(TOTAL_BUDGET_BYTES);
  });
});
