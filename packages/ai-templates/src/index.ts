/**
 * `@siyahtus/ai-templates` — the platform's ready-made procedure templates
 * (tm 311 · AI-15 · ADR `docs/adr/ai-template-catalog.md`). Only the API reads
 * it at run time; web and mobile read the catalogue through `GET /ai-templates`.
 *
 * The entry point imports no value from another package (`package.test.ts`).
 * The validator is `./validate.js`, for tests and tooling.
 */
export * from './catalogue.js';
export * from './igaming/index.js';
export { DEPOSIT_NOT_CREDITED } from './igaming/deposit-not-credited.js';
