/**
 * The workspace's hand-over routes (tm 307.1 · SiyahTuş analysis AI-12, shared
 * with AU-01): `GET`/`POST /handoff-routes`, `PATCH`/`DELETE
 * /handoff-routes/:routeId`.
 *
 * A route sends a routing topic or a hand-over reason to a team, by id. It is
 * routing configuration — the routing rules' scopes and role — and an AI
 * editing table at once (ADR-14b §2.12): every write goes through
 * `config-draft.ts`. What a route names (team, expertise, brand) must be this
 * workspace's when it is written; a team or an expertise deleted later is the
 * resolver's to step past (tm 307.2).
 */
import type { FastifyInstance } from 'fastify';
import { Prisma, type HandoffRoute } from '@prisma/client';
import { z } from 'zod';
import {
  HANDOFF_ROUTE_MATCH_TYPES,
  HANDOFF_ROUTES_MAX,
  THREAD_PRIORITIES,
  isHandoffRouteKey,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import type { TenantClient } from '../lib/tenant.js';
import {
  createHandoffRouteDraft,
  deleteHandoffRouteDraft,
  updateHandoffRouteDraft,
} from '../services/ai/config-draft.js';
import { configAuthorOf } from '../lib/config-author.js';

const READ = ['access_rules:ro', 'access_rules:rw'];
const WRITE = ['access_rules:rw'];

const uuid = z.string().uuid();
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const createBody = z
  .object({
    brand_id: uuid.nullable().optional(),
    match_type: z.enum(HANDOFF_ROUTE_MATCH_TYPES),
    match_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    group_id: id,
    required_expertise_id: id.nullable().optional(),
    default_priority: z.enum(THREAD_PRIORITIES).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const updateBody = z
  .object({
    group_id: id.optional(),
    required_expertise_id: id.nullable().optional(),
    default_priority: z.enum(THREAD_PRIORITIES).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

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

/**
 * What a route names is the workspace's own. Read under RLS, so another
 * workspace's id is one this workspace does not have — the route would send
 * conversations to nobody, or demand an expertise nobody can hold.
 */
async function requireNamed(
  tx: TenantClient,
  named: { groupId?: number; expertiseId?: number | null; brandId?: string | null },
): Promise<void> {
  if (named.groupId !== undefined) {
    const group = await tx.group.findFirst({
      where: { id: BigInt(named.groupId) },
      select: { id: true },
    });
    if (!group) {
      throw ApiError.validation('group_id: not a team of this workspace.', {
        reason: 'handoff_route_unknown_team',
      });
    }
  }
  if (named.expertiseId !== undefined && named.expertiseId !== null) {
    const expertise = await tx.expertise.findFirst({
      where: { id: BigInt(named.expertiseId), archived: false },
      select: { id: true },
    });
    if (!expertise) {
      throw ApiError.validation('required_expertise_id: not an expertise of this workspace.', {
        reason: 'handoff_route_unknown_expertise',
      });
    }
  }
  if (named.brandId !== undefined && named.brandId !== null) {
    const brand = await tx.brand.findFirst({ where: { id: named.brandId }, select: { id: true } });
    if (!brand) {
      throw ApiError.validation('brand_id: not a brand of this workspace.', {
        reason: 'handoff_route_unknown_brand',
      });
    }
  }
}

/** Every-brand routes first, then by brand, match type and key: the order the console lists them in. */
const ORDER: Prisma.HandoffRouteOrderByWithRelationInput[] = [
  { brandId: { sort: 'asc', nulls: 'first' } },
  { matchType: 'asc' },
  { matchKey: 'asc' },
  { id: 'asc' },
];

function serialiseRoute(route: HandoffRoute) {
  return {
    id: route.id,
    brand_id: route.brandId,
    match_type: route.matchType,
    match_key: route.matchKey,
    group_id: Number(route.groupId),
    required_expertise_id:
      route.requiredExpertiseId === null ? null : Number(route.requiredExpertiseId),
    default_priority: route.defaultPriority,
    active: route.active,
    created_by: route.createdBy,
    updated_by: route.updatedBy,
    created_at: route.createdAt.toISOString(),
    updated_at: route.updatedAt.toISOString(),
  };
}

export default async function handoffRoutesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/handoff-routes', { config: { scopes: READ } }, async (request, reply) => {
    const routes = await request.withTenant((tx) =>
      tx.handoffRoute.findMany({ orderBy: ORDER, take: HANDOFF_ROUTES_MAX }),
    );
    return reply.send({ items: routes.map(serialiseRoute) });
  });

  app.post(
    '/handoff-routes',
    { config: { scopes: WRITE, minimumRole: 'admin' } },
    async (request, reply) => {
      const input = parse(createBody, request.body);
      if (!isHandoffRouteKey(input.match_type, input.match_key)) {
        throw ApiError.validation(
          `match_key: ${input.match_key} is not a ${input.match_type} a route can match.`,
          { reason: 'handoff_route_bad_key' },
        );
      }
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      const actor = principal.kind === 'agent' ? principal.accountId : null;
      const brandId = input.brand_id ?? null;

      const created = await request
        .withTenant(async (tx) => {
          await requireNamed(tx, {
            groupId: input.group_id,
            expertiseId: input.required_expertise_id ?? null,
            brandId,
          });
          // Checked here rather than left to the partial unique indexes, so the
          // refusal names its reason instead of surfacing as a 500.
          const taken = await tx.handoffRoute.findFirst({
            where: { brandId, matchType: input.match_type, matchKey: input.match_key },
            select: { id: true },
          });
          if (taken) {
            throw ApiError.validation('A route for this key and brand exists; edit it instead.', {
              reason: 'handoff_route_taken',
              route_id: taken.id,
            });
          }
          if ((await tx.handoffRoute.count()) >= HANDOFF_ROUTES_MAX) {
            throw ApiError.validation(`A workspace holds at most ${HANDOFF_ROUTES_MAX} routes.`, {
              reason: 'handoff_routes_limit',
              limit: HANDOFF_ROUTES_MAX,
            });
          }
          return createHandoffRouteDraft(tx, configAuthorOf(request), {
            licenseId: tenant.licenseId,
            brandId,
            matchType: input.match_type,
            matchKey: input.match_key,
            groupId: BigInt(input.group_id),
            requiredExpertiseId:
              input.required_expertise_id == null ? null : BigInt(input.required_expertise_id),
            defaultPriority: input.default_priority ?? 'normal',
            active: input.active ?? true,
            createdBy: actor,
            updatedBy: actor,
          });
        })
        .catch((error: unknown) => {
          // Two writers of the same key at once: the second meets the unique index.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw ApiError.validation('A route for this key and brand exists; edit it instead.', {
              reason: 'handoff_route_taken',
            });
          }
          throw error;
        });
      return reply.code(201).send(serialiseRoute(created));
    },
  );

  app.patch<{ Params: { routeId: string } }>(
    '/handoff-routes/:routeId',
    { config: { scopes: WRITE, minimumRole: 'admin' } },
    async (request, reply) => {
      const routeId = parse(uuid, request.params.routeId);
      const input = parse(updateBody, request.body);
      const principal = request.requirePrincipal();
      const actor = principal.kind === 'agent' ? principal.accountId : null;

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.handoffRoute.findFirst({
          where: { id: routeId },
          select: { id: true },
        });
        if (!existing) throw ApiError.notFound('Hand-over route not found.');
        await requireNamed(tx, {
          ...(input.group_id !== undefined ? { groupId: input.group_id } : {}),
          ...(input.required_expertise_id !== undefined
            ? { expertiseId: input.required_expertise_id }
            : {}),
        });
        return updateHandoffRouteDraft(tx, configAuthorOf(request), routeId, {
          ...(input.group_id !== undefined ? { groupId: BigInt(input.group_id) } : {}),
          ...(input.required_expertise_id !== undefined
            ? {
                requiredExpertiseId:
                  input.required_expertise_id === null ? null : BigInt(input.required_expertise_id),
              }
            : {}),
          ...(input.default_priority !== undefined
            ? { defaultPriority: input.default_priority }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedBy: actor,
        });
      });
      return reply.send(serialiseRoute(updated));
    },
  );

  app.delete<{ Params: { routeId: string } }>(
    '/handoff-routes/:routeId',
    { config: { scopes: WRITE, minimumRole: 'admin' } },
    async (request, reply) => {
      const routeId = parse(uuid, request.params.routeId);
      const deleted = await request.withTenant((tx) =>
        deleteHandoffRouteDraft(tx, configAuthorOf(request), routeId),
      );
      if (deleted === 0) throw ApiError.notFound('Hand-over route not found.');
      return reply.code(204).send();
    },
  );
}
