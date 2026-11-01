/**
 * Publishes the API documentation's data file (KN-04 · tm 376).
 *
 *   tsx scripts/publish-docs.ts            write apps/web/public/developers/docs/openapi.json
 *   tsx scripts/publish-docs.ts --check    exit 1 when the committed file is not what would be written
 *
 * Reads `dist/openapi.json`, so run `pnpm bundle` first (`pnpm generate` does).
 * Only operations stamped `x-public: true` are published; an internal path that
 * is stamped by mistake fails here rather than reaching the page.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadOpenApiDocument } from '../src/document.js';
import { composePublicSpec, PUBLIC_SPEC_PATH } from '../src/public-docs.js';
import { publicOperations, serializePublicSpec, surfaceFingerprint } from '../src/public-spec.js';

async function main(): Promise<void> {
  const document = loadOpenApiDocument();
  const spec = composePublicSpec(document);
  const text = serializePublicSpec(spec);
  const operations = publicOperations(document);

  if (process.argv.includes('--check')) {
    const current = await readFile(PUBLIC_SPEC_PATH, 'utf8').catch(() => '');
    if (current !== text) {
      console.error(
        `${PUBLIC_SPEC_PATH} is out of date. Run: pnpm --filter @siyahtus/contract generate`,
      );
      process.exitCode = 1;
    }
    return;
  }

  await mkdir(dirname(PUBLIC_SPEC_PATH), { recursive: true });
  await writeFile(PUBLIC_SPEC_PATH, text, 'utf8');
  console.log(
    `published ${operations.length} operation(s) ` +
      `(surface ${surfaceFingerprint(operations)}) → ${PUBLIC_SPEC_PATH}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
