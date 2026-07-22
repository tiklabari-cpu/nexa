/**
 * Runtime access to the bundled OpenAPI document.
 *
 * Read lazily from disk rather than imported, so a stale `dist/openapi.json`
 * surfaces as a clear error at call time instead of silently baking an old
 * contract into a build.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  components?: Record<string, unknown>;
  [key: string]: unknown;
}

let cached: OpenApiDocument | undefined;

export function loadOpenApiDocument(): OpenApiDocument {
  if (cached) return cached;

  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, '../dist/openapi.json');
  try {
    cached = JSON.parse(readFileSync(file, 'utf8')) as OpenApiDocument;
    return cached;
  } catch (cause) {
    throw new Error(
      `OpenAPI bundle missing at ${file}. Run \`pnpm --filter @nexa/contract build\`.`,
      { cause },
    );
  }
}

export default loadOpenApiDocument;
