/**
 * `/platform/v1/ai-catalogs/*` — the AI catalogues page (tm 389.19 ·
 * FR-ADMIN-23 · design.md §C ai-catalogs).
 *
 *   GET /ai-catalogs/guardrails            ai.read    G1–G19 + PLATFORM_GUARDRAILS_VERSION
 *   GET /ai-catalogs/crisis-text-drafts    ai.read    the per-country drafts
 *   PUT /ai-catalogs/crisis-text-drafts    ai.manage  replace the map (superadmin)
 *   GET /ai-catalogs/templates             ai.read    the iGaming pack: version, keys
 *   GET /ai-catalogs/templates/installs    ai.read    per workspace: installed / live / behind
 *   GET /ai-catalogs/compliance-pack       ai.read    the locked scenario pack: version, keys
 *   GET /ai-catalogs/qa-rubric             ai.read    the judge's criteria
 *   GET /ai-catalogs/tools                 ai.read    the tool catalogue (`not_installed` until tm 321)
 *
 * Reads write nothing. A change to the drafts records `ai_settings.crisis_drafts_updated`
 * with the countries added, changed and removed — never a text — in the same
 * transaction as the write; a body equal to what is stored records nothing.
 * The tenant API reads the drafts through `platform_ai_settings()` on every
 * guardrail-settings read, so there is nothing to announce.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CRISIS_DRAFT_COUNTRIES_MAX,
  CRISIS_DRAFT_COUNTRY_PATTERN,
  PLATFORM_CRISIS_TEXT_MAX,
  type CrisisTextDrafts,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { PlatformAiCatalogs, TEMPLATE_INSTALLS_MAX } from '../../services/platform/ai-catalogs.js';
import { parse } from './auth.js';

const read = { config: { platform: { permission: 'ai.read' as const } } };

/** Markup, whatever its shape: a draft is plain text. */
const TAG = /<\/?[a-z!][^>]*>/i;
/** Control characters other than a newline. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/;

const text = z
  .string()
  .transform((value) => value.replace(/\r\n/g, '\n').trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(PLATFORM_CRISIS_TEXT_MAX)
      .refine((value) => !TAG.test(value), { message: 'plain text only: no HTML' })
      .refine((value) => !CONTROL.test(value), { message: 'no control characters' }),
  );

const countryTexts = z.object({ en: text.optional(), tr: text.optional() }).strict();

// `reason` is the audit plugin's (checked before the handler).
const putBody = z
  .object({
    reason: z.string(),
    drafts: z.record(z.string(), countryTexts),
  })
  .strict();

const installsQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(TEMPLATE_INSTALLS_MAX).optional(),
});

export interface PlatformAiCatalogsRoutesOptions {
  now?: () => number;
}

export default async function platformAiCatalogsRoutes(
  app: FastifyInstance,
  options: PlatformAiCatalogsRoutesOptions = {},
): Promise<void> {
  const catalogs = new PlatformAiCatalogs(app.platformDb, options.now ? { now: options.now } : {});

  app.get('/ai-catalogs/guardrails', read, async () => catalogs.guardrails());

  app.get('/ai-catalogs/crisis-text-drafts', read, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await catalogs.crisisDrafts()),
  );

  app.put(
    '/ai-catalogs/crisis-text-drafts',
    {
      config: {
        platform: {
          permission: 'ai.manage',
          audit: { action: 'ai_settings.crisis_drafts_updated', target: 'settings' },
        },
      },
    },
    async (request, reply) => {
      const body = parse(putBody, request.body);
      const countries = Object.keys(body.drafts);
      if (countries.length > CRISIS_DRAFT_COUNTRIES_MAX) {
        throw ApiError.validation(
          `drafts: at most ${CRISIS_DRAFT_COUNTRIES_MAX} countries (${countries.length} given).`,
        );
      }
      const badCountry = countries.find((country) => !CRISIS_DRAFT_COUNTRY_PATTERN.test(country));
      if (badCountry !== undefined) {
        throw ApiError.validation(
          `drafts.${badCountry.slice(0, 8)}: a country is an upper-case ISO 3166-1 alpha-2 code.`,
        );
      }
      const empty = countries.find((country) => Object.keys(body.drafts[country]!).length === 0);
      if (empty !== undefined) {
        throw ApiError.validation(
          `drafts.${empty}: give a text in en or tr, or leave the country out.`,
        );
      }
      const drafts: CrisisTextDrafts = {};
      for (const country of countries) {
        const entry = body.drafts[country]!;
        drafts[country] = {
          ...(entry.en !== undefined ? { en: entry.en } : {}),
          ...(entry.tr !== undefined ? { tr: entry.tr } : {}),
        };
      }
      const session = request.requirePlatformSession();
      const outcome = await catalogs.updateCrisisDrafts(
        drafts,
        session.adminId,
        async (tx, change) => {
          await app.platformAuditLog.record(
            request.platformAuditEntry({
              targetId: 'ai.crisis_text_drafts',
              payload: {
                added: change.added,
                changed: change.changed,
                removed: change.removed,
                version: change.view.version,
              },
            }),
            tx,
          );
        },
      );
      // Unchanged: nothing written, nothing to record.
      request.platformAudit!.recorded = true;
      return reply.header('cache-control', 'no-store').send(outcome.view);
    },
  );

  app.get('/ai-catalogs/templates', read, async () => catalogs.templates());

  app.get('/ai-catalogs/templates/installs', read, async (request) => {
    const query = parse(installsQuery, request.query);
    return catalogs.templateInstalls({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
  });

  app.get('/ai-catalogs/compliance-pack', read, async () => catalogs.compliancePack());
  app.get('/ai-catalogs/qa-rubric', read, async () => catalogs.qaRubric());
  app.get('/ai-catalogs/tools', read, async () => catalogs.tools());
}
