/**
 * Contract surface consumed by the API server, the web app and the widget.
 *
 * `paths` / `components` come from `src/generated/api.ts`, which is produced by
 * `pnpm --filter @nexa/contract generate` from `openapi/openapi.yaml`. The
 * generated file is committed so consumers do not need the toolchain, and CI
 * re-runs generation to prove it is in sync with the spec.
 */
export type { components, operations, paths } from './generated/api.js';

export { default as openapiDocument } from './document.js';
