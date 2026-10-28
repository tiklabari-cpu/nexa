/**
 * The ready-made procedure templates (tm 311.3 · SiyahTuş analysis AI-15 · ADR
 * `docs/adr/ai-template-catalog.md`): `GET /ai-templates`, `GET
 * /ai-templates/{key}`, `POST /ai-templates/{key}/install`, `POST
 * /ai-templates/packs/{pack}/install`.
 *
 * The catalogue is code (`@siyahtus/ai-templates`), the same for every
 * workspace; the two reads write nothing — browsing and previewing leave no
 * trace (ADR §2.2). An install is `services/ai-templates/install.ts`'s. Whoever
 * may write skills installs (`agents-bot--all:rw`, ADR §2.2); writing a
 * hand-over route asks `access_rules:rw` too, making a team `groups--all:rw` —
 * the scopes those writes have on their own screens.
 */
import { configAuthorOf } from '../lib/config-author.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  IGAMING_CORE_PACK,
  IGAMING_TEMPLATES_TR,
  templateTopics,
  type AiTemplate,
  type AiTemplatePack,
} from '@siyahtus/ai-templates';
import { GUIDANCE_SCOPE_IDS_MAX, hasAnyScope } from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { scopesOf } from '../services/auth/principal.js';
import {
  aiTemplateOf,
  aiTemplatePackOf,
  installPack,
  installTemplate,
  packWroteAnything,
  type TemplateInstaller,
} from '../services/ai-templates/install.js';
import { serialiseRule } from './ai-guidance.js';
import { creatorName, serialiseSkill } from './playbook.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

const uuid = z.string().uuid();
const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

const listQuery = z.object({
  industry: z.enum(['igaming']).optional(),
  lang: z.enum(['tr']).optional(),
});

const brandIds = z.array(uuid).min(1).max(GUIDANCE_SCOPE_IDS_MAX);
const routeMapping = z.record(key, z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

const installBody = z
  .object({
    ai_agent_id: uuid,
    brand_ids: brandIds.optional(),
    route_mapping: routeMapping.optional(),
    force_copy: z.boolean().optional(),
  })
  .strict();

const packInstallBody = z
  .object({
    ai_agent_id: uuid,
    brand_ids: brandIds.optional(),
    route_mapping: routeMapping.optional(),
    create_groups: z.boolean().optional(),
  })
  .strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

/** A write beyond the skill's own needs that write's scope as well. */
function requireAlsoScope(request: FastifyRequest, scope: string, why: string): void {
  if (!hasAnyScope(scopesOf(request.requirePrincipal()), [scope])) {
    throw ApiError.authorization(`${why} requires the ${scope} scope.`);
  }
}

function installerOf(request: FastifyRequest): TemplateInstaller {
  const principal = request.requirePrincipal();
  return {
    licenseId: request.tenant().licenseId,
    accountId: principal.kind === 'agent' ? principal.accountId : null,
    audit: request.auditContext(),
    author: configAuthorOf(request),
  };
}

function summaryOf(template: AiTemplate, installed: ReadonlyMap<string, number>) {
  return {
    key: template.key,
    name: template.name,
    summary: template.summary,
    industry: template.industry,
    lang: template.lang,
    version: template.version,
    locked: template.locked,
    topics: templateTopics(template),
    tenant_must_fill_count: template.tenant_must_fill.length,
    installed_version: installed.get(template.key) ?? null,
  };
}

function packSummaryOf(pack: AiTemplatePack) {
  return {
    key: pack.key,
    version: pack.version,
    industry: pack.industry,
    lang: pack.lang,
    template_keys: pack.template_keys,
    default_rules_count: pack.default_rules.length,
    sample_rows_count: Object.values(pack.sample_rows).reduce((n, rows) => n + rows.length, 0),
  };
}

export default async function aiTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai-templates', { config: { scopes: READ } }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    const templates = IGAMING_TEMPLATES_TR.filter(
      (template) =>
        (query.industry === undefined || template.industry === query.industry) &&
        (query.lang === undefined || template.lang === query.lang),
    );
    const copies = await request.withTenant((tx) =>
      tx.skill.findMany({
        where: { kind: 'ai_agent', templateKey: { not: null } },
        select: { templateKey: true, templateVersion: true },
      }),
    );
    const installed = new Map<string, number>();
    for (const copy of copies) {
      const version = copy.templateVersion ?? 0;
      if (version > (installed.get(copy.templateKey!) ?? 0))
        installed.set(copy.templateKey!, version);
    }
    const packs = [IGAMING_CORE_PACK].filter(
      (pack) =>
        (query.industry === undefined || pack.industry === query.industry) &&
        (query.lang === undefined || pack.lang === query.lang),
    );
    return reply.send({
      items: templates.map((template) => summaryOf(template, installed)),
      packs: packs.map(packSummaryOf),
    });
  });

  app.get<{ Params: { templateKey: string } }>(
    '/ai-templates/:templateKey',
    { config: { scopes: READ } },
    async (request, reply) => {
      const template = aiTemplateOf(request.params.templateKey);
      if (!template) throw ApiError.notFound('Template not found.');
      const copies = await request.withTenant((tx) =>
        tx.skill.findMany({
          where: { kind: 'ai_agent', templateKey: template.key },
          select: { templateVersion: true },
        }),
      );
      const newest = Math.max(0, ...copies.map((copy) => copy.templateVersion ?? 0));
      const procedure = JSON.parse(JSON.stringify(template.procedure)) as AiTemplate['procedure'];
      const { when_to_use, examples, priority, slots, ...rest } = procedure;
      return reply.send({
        ...summaryOf(template, new Map(newest > 0 ? [[template.key, newest]] : [])),
        when_to_use,
        examples,
        priority,
        slots,
        procedure: rest,
        forbidden_phrases: template.forbidden_phrases,
        tenant_must_fill: template.tenant_must_fill,
        scenarios: template.scenarios,
        card_example: template.card_example ?? null,
      });
    },
  );

  app.post<{ Params: { templateKey: string } }>(
    '/ai-templates/:templateKey/install',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const body = parse(installBody, request.body);
      const template = aiTemplateOf(request.params.templateKey);
      if (!template) throw ApiError.notFound('Template not found.');
      if (body.route_mapping && Object.keys(body.route_mapping).length > 0) {
        requireAlsoScope(request, 'access_rules:rw', 'Writing a hand-over route');
      }
      const installer = installerOf(request);

      const { outcome, createdByName } = await request.withTenant(async (tx) => {
        const outcome = await installTemplate(tx, installer, template, {
          aiAgentId: body.ai_agent_id,
          ...(body.brand_ids ? { brandIds: body.brand_ids } : {}),
          ...(body.route_mapping ? { routeMapping: body.route_mapping } : {}),
          ...(body.force_copy !== undefined ? { forceCopy: body.force_copy } : {}),
        });
        return { outcome, createdByName: await creatorName(tx, outcome.skill.createdBy) };
      });
      return reply.status(outcome.created ? 201 : 200).send({
        created: outcome.created,
        skill: serialiseSkill(outcome.skill, createdByName),
        tenant_must_fill: template.tenant_must_fill,
        unfilled_placeholders: outcome.unfilledPlaceholders,
        unmapped_topics: outcome.unmappedTopics,
      });
    },
  );

  app.post<{ Params: { packKey: string } }>(
    '/ai-templates/packs/:packKey/install',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const body = parse(packInstallBody, request.body);
      const pack = aiTemplatePackOf(request.params.packKey);
      if (!pack) throw ApiError.notFound('Pack not found.');
      if (body.route_mapping && Object.keys(body.route_mapping).length > 0) {
        requireAlsoScope(request, 'access_rules:rw', 'Writing a hand-over route');
      }
      if (body.create_groups === true) {
        requireAlsoScope(request, 'groups--all:rw', 'Making a team');
      }
      const installer = installerOf(request);

      const outcome = await request.withTenant((tx) =>
        installPack(tx, installer, pack, {
          aiAgentId: body.ai_agent_id,
          ...(body.brand_ids ? { brandIds: body.brand_ids } : {}),
          ...(body.route_mapping ? { routeMapping: body.route_mapping } : {}),
          ...(body.create_groups !== undefined ? { createGroups: body.create_groups } : {}),
        }),
      );
      return reply.status(packWroteAnything(outcome) ? 201 : 200).send({
        pack: pack.key,
        version: pack.version,
        templates: outcome.templates.map(({ template, outcome: one }) => ({
          template_key: template.key,
          skill_id: one.skill.id,
          created: one.created,
          tenant_must_fill: template.tenant_must_fill,
          unfilled_placeholders: one.unfilledPlaceholders,
          unmapped_topics: one.unmappedTopics,
        })),
        rules: {
          created: outcome.rulesCreated.map(serialiseRule),
          existing: outcome.rulesExisting,
        },
        sample_rows: { created: outcome.sampleRows.created, skipped: outcome.sampleRows.skipped },
        groups_created: outcome.groupsCreated,
        persona_style: pack.persona_style,
        unmapped_topics: outcome.unmappedTopics,
      });
    },
  );
}
