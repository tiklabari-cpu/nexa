/**
 * Goals — tracked conversion targets (FR-MOD-13.3).
 *
 * Reads take `customers:ro`, writes `customers:rw`. Goals describe conversions
 * for the same visitors the CRM, the live board and campaigns already cover, so
 * they ride the customer scopes rather than inventing one the source platform's
 * ~63-scope list never had. The effect is that owners and admins (who hold
 * `customers:rw`) define what counts as a conversion, while an ordinary agent
 * can see the goals but not change them.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { GoalService, type GoalInput, type GoalPatch } from '../services/goals/goal-service.js';

const listQuery = z.object({
  status: z.enum(['all', 'active', 'inactive']).default('all'),
});

// `.strict()` so a typo in a definition key (`url_contain`) is a 400, not a
// silently-ignored rule that leaves a goal nobody can ever reach.
const definitionSchema = z
  .object({ url_contains: z.string().trim().max(2048).optional() })
  .strict();

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
  definition: definitionSchema,
});

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
    definition: definitionSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const goalIdSchema = z.string().uuid();

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

export default async function goalRoutes(app: FastifyInstance): Promise<void> {
  const goals = new GoalService();

  app.get(
    '/goals',
    { config: { scopes: ['customers:ro', 'customers:rw'] } },
    async (request, reply) => {
      const query = parse(listQuery, request.query);
      const tenant = request.tenant();
      const result = await request.withTenant((tx) => goals.list(tx, tenant, query));
      return reply.send(result);
    },
  );

  app.post('/goals', { config: { scopes: ['customers:rw'] } }, async (request, reply) => {
    const body = parse(createBody, request.body);
    const tenant = request.tenant();
    const input: GoalInput = {
      name: body.name,
      active: body.active,
      definition: body.definition,
    };
    const goal = await request.withTenant((tx) => goals.create(tx, tenant, input));
    return reply.status(201).send(goal);
  });

  app.patch<{ Params: { goalId: string } }>(
    '/goals/:goalId',
    { config: { scopes: ['customers:rw'] } },
    async (request, reply) => {
      const id = parse(goalIdSchema, request.params.goalId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();
      const patch: GoalPatch = {
        name: body.name,
        active: body.active,
        definition: body.definition,
      };
      const goal = await request.withTenant((tx) => goals.update(tx, tenant, id, patch));
      return reply.send(goal);
    },
  );
}
