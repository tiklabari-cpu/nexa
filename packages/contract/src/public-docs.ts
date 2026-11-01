/**
 * Composes and locates the published documentation (KN-04 · tm 376).
 *
 * Kept apart from `index.ts` on purpose: it reads the changelog with `yaml`, a
 * build-time dependency, and the contract's consumers (the API, the web app,
 * the widget) must not have to carry it. Used by `scripts/publish-docs.ts` and
 * by the tests.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { OpenApiDocument } from './document.js';
import { buildPublicGuides } from './public-guide.js';
import {
  buildPublicSpec,
  serializePublicSpec,
  type ChangelogEntry,
  type PublicSpec,
} from './public-spec.js';

const here = dirname(fileURLToPath(import.meta.url));

export const CHANGELOG_PATH = resolve(here, '../openapi/public-changelog.yaml');

/**
 * Where the published document is written. It lives with the static viewer
 * (`apps/web/developers/docs`) so the web image serves both from one origin, and
 * is committed like `src/generated` — `pnpm contract:generate` rewrites it and
 * `public-spec.test.ts` fails when the committed copy is stale.
 */
export const PUBLIC_SPEC_PATH = resolve(
  here,
  '../../../apps/web/public/developers/docs/openapi.json',
);

export function loadChangelog(): ChangelogEntry[] {
  const entries = parse(readFileSync(CHANGELOG_PATH, 'utf8')) as unknown;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${CHANGELOG_PATH} must be a non-empty list`);
  }
  return entries as ChangelogEntry[];
}

/** The document that should be on disk for `document` — the single place it is assembled. */
export function composePublicSpec(document: OpenApiDocument): PublicSpec {
  return buildPublicSpec(document, { guides: buildPublicGuides(), changelog: loadChangelog() });
}

export function composePublicSpecText(document: OpenApiDocument): string {
  return serializePublicSpec(composePublicSpec(document));
}
