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

const cached = new Map<string, OpenApiDocument>();

function load(bundle: string): OpenApiDocument {
  const hit = cached.get(bundle);
  if (hit) return hit;

  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, '../dist', bundle);
  try {
    const document = JSON.parse(readFileSync(file, 'utf8')) as OpenApiDocument;
    cached.set(bundle, document);
    return document;
  } catch (cause) {
    throw new Error(
      `OpenAPI bundle missing at ${file}. Run \`pnpm --filter @siyahtus/contract build\`.`,
      { cause },
    );
  }
}

/** The tenant contract — `openapi/openapi.yaml`, served under `/api/v1`. */
export function loadOpenApiDocument(): OpenApiDocument {
  return load('openapi.json');
}

/**
 * The platform (root panel) contract — `platform/openapi.yaml`, served under
 * `/platform/v1` by the platform-api process only (tm 389.3).
 */
export function loadPlatformOpenApiDocument(): OpenApiDocument {
  return load('platform-openapi.json');
}

export default loadOpenApiDocument;
