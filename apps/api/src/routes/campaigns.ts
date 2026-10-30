/**
 * Campaigns — proactive, targeted messages (FR-MOD-03.3).
 *
 * Reads take `customers:ro`, writes `customers:rw`. Campaigns live in the
 * Customers area and target the same visitors the CRM and the live board cover,
 * so — as with real-time traffic — they ride the customer scopes rather than
 * inventing one the source platform's ~63-scope list never had. The effect is
 * that owners and admins (who hold `customers:rw`) manage campaigns while an
 * ordinary agent can see them but not launch one.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CAMPAIGN_CONTENT_TYPES,
  CAMPAIGN_MATCH_MODES,
  CAMPAIGN_MESSAGE_MAX,
  CAMPAIGN_RULE_FIELDS,
  CAMPAIGN_RULE_OPS,
  CAMPAIGN_RULE_TEXT_MAX,
  CAMPAIGN_RULES_MAX,
  SESSION_VARIABLE_MAX_LENGTH,
  isCardUploadPath,
  type CampaignContent,
  type RichCard,
} from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import type { TenantContext } from '../lib/tenant.js';
import {
  CampaignService,
  type CampaignInput,
  type CampaignPatch,
} from '../services/campaigns/campaign-service.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { assertUploadedAttachment } from '../services/storage/attachment.js';
import { createObjectStore } from '../services/storage/object-store.js';
import { publishTrafficChange } from '../services/traffic/traffic-events.js';

const listQuery = z.object({
  status: z.enum(['all', 'ongoing', 'scheduled', 'inactive']).default('all'),
});

// `.strict()` so a typo in a condition key (`url_contain`) is a 400, not a
// silently-ignored rule that quietly matches nobody. The shape is checked
// here; whether each rule makes sense for its field (`campaignRuleProblem`)
// and the rule cap are the service's, so every caller gets the same answer.
const ruleSchema = z
  .object({
    field: z.enum(CAMPAIGN_RULE_FIELDS),
    op: z.enum(CAMPAIGN_RULE_OPS),
    value: z.union([z.string().max(CAMPAIGN_RULE_TEXT_MAX), z.number(), z.boolean()]),
    key: z.string().max(SESSION_VARIABLE_MAX_LENGTH).optional(),
  })
  .strict();
const conditionsSchema = z
  .object({
    match: z.enum(CAMPAIGN_MATCH_MODES).optional(),
    rules: z.array(ruleSchema).max(CAMPAIGN_RULES_MAX).optional(),
    // The first shape (EN-04's "current page contains"); `rules` wins when both
    // are sent, so a client echoing a saved campaign back is not refused.
    url_contains: z.string().trim().max(2048).optional(),
  })
  .strict();
// The card's shape and limits are the service's (`richCardProblems`), so the
// 400 names the button at fault in the same words the builder shows (EN-02).
const contentSchema = z
  .object({
    type: z.enum(CAMPAIGN_CONTENT_TYPES).optional(),
    message: z.string().trim().min(1).max(CAMPAIGN_MESSAGE_MAX).optional(),
    card: z.custom<RichCard>().optional(),
    fallback_text: z.string().trim().min(1).max(CAMPAIGN_MESSAGE_MAX).optional(),
  })
  .strict();

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
  conditions: conditionsSchema,
  content: contentSchema,
  starts_at: z.coerce.date().nullable().optional(),
  ends_at: z.coerce.date().nullable().optional(),
  recurring: z.boolean().optional(),
});

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
    conditions: conditionsSchema.optional(),
    content: contentSchema.optional(),
    starts_at: z.coerce.date().nullable().optional(),
    ends_at: z.coerce.date().nullable().optional(),
    recurring: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const duplicateBody = z.object({ name: z.string().trim().min(1).max(120).optional() });

const campaignIdSchema = z.string().uuid();

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

export default async function campaignRoutes(
  app: FastifyInstance,
  { env }: { env: Env },
): Promise<void> {
  const campaigns = new CampaignService();
  const publisher = new RealtimePublisher(app.redis, app.log);
  const store = createObjectStore(env.STORAGE_PROVIDER, env.storage);

  /**
   * A card's image given as an upload path must be a file this workspace
   * uploaded (EN-02) — the check a chat attachment gets — so a card cannot
   * point a visitor's widget at another workspace's file.
   */
  async function assertCardImage(tenant: TenantContext, content: CampaignContent | undefined) {
    const image = (content?.card as { image?: { url?: unknown } } | undefined)?.image;
    const url = typeof image?.url === 'string' ? image.url.trim() : '';
    if (isCardUploadPath(url)) await assertUploadedAttachment(store, tenant.licenseId, url);
  }

  /**
   * Tell the real-time board that a fire just moved people into `invited`
   * (FR-MOD-03.1.1).
   *
   * After the transaction, never inside it — the board's reaction is to re-read
   * `GET /traffic`, and a re-read that beat the commit would come back with the
   * board exactly as it was and leave it stale until the backup poll. Sequential
   * rather than `Promise.all` for the same reason every other publisher here is:
   * a burst of Redis publishes ahead of the response buys nothing, and the
   * client coalesces whatever arrives.
   */
  async function announceInvited(tenant: TenantContext, customerIds: string[]): Promise<void> {
    for (const customerId of customerIds) {
      await publishTrafficChange(publisher, tenant, customerId);
    }
  }

  app.get(
    '/campaigns',
    { config: { scopes: ['customers:ro', 'customers:rw'] } },
    async (request, reply) => {
      const query = parse(listQuery, request.query);
      const tenant = request.tenant();
      const result = await request.withTenant((tx) => campaigns.list(tx, tenant, query));
      return reply.send(result);
    },
  );

  app.post('/campaigns', { config: { scopes: ['customers:rw'] } }, async (request, reply) => {
    const body = parse(createBody, request.body);
    const tenant = request.tenant();
    await assertCardImage(tenant, body.content);
    const input: CampaignInput = {
      name: body.name,
      active: body.active,
      conditions: body.conditions,
      content: body.content,
      startsAt: body.starts_at ?? null,
      endsAt: body.ends_at ?? null,
      recurring: body.recurring,
    };
    const result = await request.withTenant((tx) => campaigns.create(tx, tenant, input));
    await announceInvited(tenant, result.invited);
    // `sent` is the freshly-written rows — exactly "how many were just
    // targeted", the number a "reached N visitors" notification wants
    // (FR-MOD-03.3.1-.3 · tm 244). `performance.displayed` stays untouched:
    // it counts delivered sends, and nothing is delivered yet at this instant.
    return reply.status(201).send({ ...result.campaign, matched: result.sent });
  });

  // Delete is an archive (EN-05): the campaign leaves the list and stops firing,
  // its sends stay for the report.
  app.delete<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId',
    { config: { scopes: ['customers:rw'] } },
    async (request, reply) => {
      const id = parse(campaignIdSchema, request.params.campaignId);
      const tenant = request.tenant();
      await request.withTenant((tx) => campaigns.archive(tx, tenant, id));
      return reply.status(204).send();
    },
  );

  // A copy, switched off — nothing is sent until its owner turns it on.
  app.post<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/duplicate',
    { config: { scopes: ['customers:rw'] } },
    async (request, reply) => {
      const id = parse(campaignIdSchema, request.params.campaignId);
      const body = parse(duplicateBody, request.body ?? {});
      const tenant = request.tenant();
      const result = await request.withTenant((tx) =>
        campaigns.duplicate(tx, tenant, id, body.name),
      );
      return reply.status(201).send({ ...result.campaign, matched: result.sent });
    },
  );

  app.patch<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId',
    { config: { scopes: ['customers:rw'] } },
    async (request, reply) => {
      const id = parse(campaignIdSchema, request.params.campaignId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();
      await assertCardImage(tenant, body.content);
      // Absent keys stay undefined (leave the field alone); an explicit null on a
      // schedule field clears it. The service reads that distinction.
      const patch: CampaignPatch = {
        name: body.name,
        active: body.active,
        conditions: body.conditions,
        content: body.content,
        startsAt: body.starts_at,
        endsAt: body.ends_at,
        recurring: body.recurring,
      };
      const result = await request.withTenant((tx) => campaigns.update(tx, tenant, id, patch));
      await announceInvited(tenant, result.invited);
      return reply.send({ ...result.campaign, matched: result.sent });
    },
  );
}
