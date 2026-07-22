/**
 * Bundles the OpenAPI source (which may be split across files via $ref) into a
 * single dist/openapi.json, and fails loudly on any spec error.
 *
 * This is the contract-first gate: types, the API server's route schemas and the
 * web client all derive from the artifact this produces, so an invalid spec must
 * never reach them.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle, createConfig } from '@redocly/openapi-core';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const entrypoint = resolve(packageRoot, 'openapi/openapi.yaml');
const outFile = resolve(packageRoot, 'dist/openapi.json');

async function main(): Promise<void> {
  const config = await createConfig({
    extends: ['recommended'],
    rules: {
      // Documentation polish, not contract correctness — must not fail the build.
      'info-contact': 'off',
      'info-license': 'off',
      'operation-4xx-response': 'off',
      'no-unused-components': 'off',
      'tag-description': 'off',
      // Contract correctness — these must fail the build.
      struct: 'error',
      'security-defined': 'error',
      'operation-operationId': 'error',
      'operation-operationId-unique': 'error',
      'path-parameters-defined': 'error',
      'no-invalid-schema-examples': 'error',
    },
  });

  const { bundle: bundled, problems } = await bundle({ config, ref: entrypoint });

  const errors = problems.filter((p) => p.severity === 'error');
  for (const problem of problems) {
    const where =
      problem.location?.[0]?.pointer ?? problem.location?.[0]?.source?.absoluteRef ?? '';
    console[problem.severity === 'error' ? 'error' : 'warn'](
      `  ${problem.severity.padEnd(5)} ${problem.message}${where ? ` (${where})` : ''}`,
    );
  }
  if (errors.length > 0) {
    throw new Error(`OpenAPI document has ${errors.length} error(s) — refusing to emit a bundle`);
  }

  const document = bundled.parsed as { paths?: Record<string, unknown> };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  console.log(`bundled ${Object.keys(document.paths ?? {}).length} path(s) → ${outFile}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
