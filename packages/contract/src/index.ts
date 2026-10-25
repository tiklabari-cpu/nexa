/**
 * Contract surface consumed by the API server, the web app and the widget.
 *
 * `paths` / `components` come from `src/generated/api.ts`, which is produced by
 * `pnpm --filter @siyahtus/contract generate` from `openapi/openapi.yaml`. The
 * generated file is committed so consumers do not need the toolchain, and CI
 * re-runs generation to prove it is in sync with the spec.
 */
export type { components, operations, paths } from './generated/api.js';
/**
 * The platform (root panel) contract's types (tm 389.3), generated from
 * `platform/openapi.yaml` into `src/generated/platform.ts`. Renamed on the way
 * out so a tenant consumer never picks a platform type up by its bare name.
 */
export type {
  components as platformComponents,
  operations as platformOperations,
  paths as platformPaths,
} from './generated/platform.js';

export {
  default as openapiDocument,
  loadOpenApiDocument,
  loadPlatformOpenApiDocument,
} from './document.js';
export type { OpenApiDocument } from './document.js';
