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
import { ApiError } from '../lib/api-error.js';
import type { TenantContext } from '../lib/tenant.js';
import {
  CampaignService,
  type CampaignInput,
  type CampaignPatch,
} from '../services/campaigns/campaign-service.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { publishTrafficChange } from '../services/traffic/traffic-events.js';

const listQuery = z.object({
  status: z.enum(['all', 'ongoing', 'scheduled', 'inactive']).default('all'),
});

// `.strict()` so a typo in a condition key (`url_contain`) is a 400, not a
// silently-ignored rule that quietly matches nobody.
const conditionsSchema = z
  .object({ url_contains: z.string().trim().max(2048).optional() })
  .strict();
const contentSchema = z.object({ message: z.string().trim().min(1).max(2000).optional() }).strict();

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

export default async function campaignRoutes(app: FastifyInstance): Promise<void> {
  const campaigns = new CampaignService();
  const publisher = new RealtimePublisher(app.redis, app.log);

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
    return reply.status(201).send(result.campaign);
  });

  app.patch<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId',
    { config: { scopes: ['customers:rw'] } },
    async (request, reply) => {
      const id = parse(campaignIdSchema, request.params.campaignId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();
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
      return reply.send(result.campaign);
    },
  );
}
