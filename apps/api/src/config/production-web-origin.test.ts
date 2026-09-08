/**
 * The four deployment documents have to name the widget's origin (tm 243).
 *
 * `productionProblems` (env.ts) is the real gate: it refuses to boot a
 * production API whose `WEB_ORIGIN` omits `WIDGET_BASE_URL`'s origin, and it
 * covers deployments that write their own configuration rather than copying
 * anything. What it cannot do is stop this repository from handing an operator
 * a template that trips it — which is exactly what all four of these files did,
 * for a week, in the same words: "set `WEB_ORIGIN` to the panel origin(s)",
 * with `WIDGET_BASE_URL` three lines below and no hint the two were related.
 *
 * So this file guards the documents, and the boot check guards the deployment.
 * Neither is redundant with the other: an example that fails at boot is a
 * worse example, and a document nobody checks drifts back — the storage
 * comment `chart-storage.test.ts` pins had gone stale a week after the code it
 * described, which is why that file reads the manifest instead of trusting it.
 *
 * The two machine-readable examples are compared value-to-value; the two prose
 * documents are only asked to mention the key, because pinning an English
 * sentence any harder buys a false negative on the first rewording.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// src/config → apps/api → apps → repo root (same resolution as env.parity.test.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path: string): string => readFileSync(resolve(REPO_ROOT, path), 'utf8');

const ENV_EXAMPLE = '.env.production.example';
const CHART_OVERLAY = 'infra/helm/nexa/values.production.example.yaml';
const CHECKLIST = 'docs/production-checklist.md';
const README = 'README.md';

/**
 * Splits a `WEB_ORIGIN` value the way `parseOriginList` does, minus the URL
 * parsing — these files carry `https://panel.<your-domain>`, which is not a
 * URL any parser accepts and is not meant to be. Comparing the placeholders as
 * text is the whole point: what has to match is what an operator will edit.
 */
const originList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter((entry) => entry.length > 0);

/** `KEY=value`, uncommented — the shape `.env.production.example` is written in. */
function envValue(source: string, key: string): string | undefined {
  return new RegExp(`^${key}=(.*)$`, 'm').exec(source)?.[1]?.trim();
}

/** `  KEY: "value"`, uncommented — one flat key under the overlay's `config:` map. */
function yamlValue(source: string, key: string): string | undefined {
  const raw = new RegExp(`^\\s+${key}:\\s*(.*)$`, 'm').exec(source)?.[1]?.trim();
  return raw?.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

describe('the deployment templates put the widget on the CORS allowlist (tm 243)', () => {
  it.each([
    [ENV_EXAMPLE, envValue],
    [CHART_OVERLAY, yamlValue],
  ])("%s's WEB_ORIGIN contains its own WIDGET_BASE_URL", (path, valueOf) => {
    const source = read(path);
    const webOrigin = valueOf(source, 'WEB_ORIGIN');
    const widgetBaseUrl = valueOf(source, 'WIDGET_BASE_URL');

    expect(webOrigin, `${path} sets no WEB_ORIGIN`).toBeDefined();
    expect(widgetBaseUrl, `${path} sets no WIDGET_BASE_URL`).toBeDefined();
    expect(
      originList(webOrigin!),
      `${path} tells an operator to allow ${webOrigin} while serving the widget from ` +
        `${widgetBaseUrl}: followed literally, the agent panel works and every customer ` +
        'conversation is refused by CORS. api refuses to boot on this pair.',
    ).toContain(widgetBaseUrl!.replace(/\/+$/, ''));
  });

  it('the reader is not vacuous — the same check fails on the value these files used to ship', () => {
    // Without this, an `originList` that returned nothing useful (or a regex
    // that matched nothing) would leave the two assertions above passing for
    // the wrong reason. The pair below is verbatim what tm 212 found.
    expect(originList('https://panel.<your-domain>')).not.toContain('https://widget.<your-domain>');
    expect(originList('https://panel.<your-domain>,https://widget.<your-domain>/')).toContain(
      'https://widget.<your-domain>',
    );
    expect(envValue('# WEB_ORIGIN=commented-out\n', 'WEB_ORIGIN')).toBeUndefined();
  });

  it.each([
    [CHECKLIST, /^-\s\[\s\]\s`WEB_ORIGIN`[\s\S]*?(?=\n-\s\[\s\]|\n##\s)/m],
    [README, /^###\s`WEB_ORIGIN`[\s\S]*?(?=\n###\s)/m],
  ])("%s's WEB_ORIGIN instruction names WIDGET_BASE_URL", (path, sectionPattern) => {
    // Prose cannot be pinned to a sentence without breaking on the next honest
    // rewrite, so the assertion is the one thing that must survive any
    // rewording: an operator reading only this passage has to learn that the
    // widget's origin belongs on the list.
    const section = sectionPattern.exec(read(path))?.[0];

    expect(section, `${path} has no WEB_ORIGIN section this reader can find`).toBeDefined();
    expect(section, `${path} describes WEB_ORIGIN without mentioning WIDGET_BASE_URL`).toContain(
      'WIDGET_BASE_URL',
    );
  });
});
