/**
 * Workspace settings.
 *
 * Everything here already existed in the schema and could previously only be
 * changed by editing the database. Trusted domains is the one that mattered
 * most: until a customer's domain is on this list the widget cannot mint a
 * token on their site, so the product shipped in a state nobody could deploy.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { normaliseTrustedDomain } from '../lib/origin.js';

const SHORTCUT = /^[A-Za-z0-9_-]{1,40}$/;

const addDomainBody = z.object({
  domain: z.string().trim().min(1).max(253),
  include_subdomains: z.boolean().default(false),
});

const cannedListQuery = z.object({ scope: z.enum(['chat', 'ticket']).optional() });

const createCannedBody = z.object({
  shortcut: z.string().trim().regex(SHORTCUT, 'letters, digits, _ and - only, up to 40'),
  text: z.string().trim().min(1).max(10_000),
  scope: z.enum(['chat', 'ticket']).default('chat'),
});

const updateCannedBody = z
  .object({
    shortcut: z
      .string()
      .trim()
      .regex(SHORTCUT, 'letters, digits, _ and - only, up to 40')
      .optional(),
    text: z.string().trim().min(1).max(10_000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const updateRuleBody = z
  .object({
    enabled: z.boolean().optional(),
    target_group_id: z.coerce.bigint().nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

/**
 * `type/subtype`, the shape a browser actually puts in `Content-Type`.
 *
 * Rejecting anything else is the point: `.pdf` or `pdf` would sit in the
 * allowlist looking like a rule while matching no upload ever labelled by a
 * browser, so file sharing would appear configured and block everything.
 */
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** 100 MiB. Above this the signed-upload path (FR-MOD-08.9.4-b) is not viable. */
const MAX_FILE_SIZE_CEILING = 104_857_600;

/**
 * Mirrors the column defaults in `schema.prisma` (`model SecuritySettings`).
 *
 * Signup does not create this row — only the seed does — so a real workspace
 * reads these until it saves for the first time. They are duplicated here
 * rather than read from the database because a read should not have to write a
 * row to answer; `returns the schema defaults when no row exists` in
 * `settings.test.ts` pins the two copies together.
 */
const SECURITY_DEFAULTS = {
  fileSharingEnabled: true,
  allowedFileTypes: ['image/png', 'image/jpeg', 'application/pdf'],
  maxFileSizeBytes: 10_485_760,
  spamFilterEnabled: true,
  requireTwoFactor: false,
} as const;

const updateSecurityBody = z
  .object({
    file_sharing_enabled: z.boolean().optional(),
    allowed_file_types: z
      .array(z.string().trim().toLowerCase().max(255))
      .max(50)
      .refine((types) => types.every((type) => MIME.test(type)), {
        message: 'each entry must be a MIME type such as image/png',
      })
      .optional(),
    max_file_size_bytes: z.number().int().min(1).max(MAX_FILE_SIZE_CEILING).optional(),
    spam_filter_enabled: z.boolean().optional(),
    require_two_factor: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const uuid = z.string().uuid();

/**
 * Same normalisation the inbox applies when an agent tags a conversation
 * (`chat-service.tagThread`): trimmed and lowercased. Keeping the two in step is
 * the point of the library — otherwise `VIP` typed in the composer and `vip`
 * curated here would be two labels that look like one.
 */
const tagName = z.string().trim().toLowerCase().min(1).max(64);
const tagGroupIds = z.array(z.coerce.bigint()).max(50);

const createTagBody = z.object({
  name: tagName,
  group_ids: tagGroupIds.default([]),
});

const updateTagBody = z
  .object({
    name: tagName.optional(),
    group_ids: tagGroupIds.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

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

/** Prisma's unique-violation code, raised by the tenant-scoped indexes here. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export default async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // --- Trusted domains -------------------------------------------------------

  app.get(
    '/settings/trusted-domains',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const items = await request.withTenant((tx) =>
        tx.trustedDomain.findMany({ orderBy: { domain: 'asc' } }),
      );
      return reply.send({
        items: items.map((d) => ({
          id: d.id,
          domain: d.domain,
          include_subdomains: d.includeSubdomains,
          created_at: d.createdAt.toISOString(),
        })),
      });
    },
  );

  app.post(
    '/settings/trusted-domains',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(addDomainBody, request.body);
      const tenant = request.tenant();

      // Normalised with the same rule the token endpoint applies to an Origin
      // header. A domain stored in any other shape would sit in the list
      // looking correct and never match anything.
      const domain = normaliseTrustedDomain(body.domain);
      if (!domain) {
        throw ApiError.validation(
          'Enter a hostname such as shop.example, or a URL to take one from.',
        );
      }

      try {
        const created = await request.withTenant((tx) =>
          tx.trustedDomain.create({
            data: {
              organizationId: tenant.organizationId,
              licenseId: tenant.licenseId,
              domain,
              includeSubdomains: body.include_subdomains,
            },
          }),
        );

        return reply.status(201).send({
          id: created.id,
          domain: created.domain,
          include_subdomains: created.includeSubdomains,
          created_at: created.createdAt.toISOString(),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError('not_allowed', `${domain} is already on the allowlist.`);
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { domainId: string } }>(
    '/settings/trusted-domains/:domainId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const domainId = parse(uuid, request.params.domainId);

      const deleted = await request.withTenant(async (tx) => {
        // Scoped delete rather than `delete by id`: the id alone would let a
        // caller remove another tenant's domain if RLS were ever misconfigured.
        const { count } = await tx.trustedDomain.deleteMany({ where: { id: domainId } });
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Domain not found.');

      return reply.status(204).send();
    },
  );

  // --- Canned responses ------------------------------------------------------

  app.get(
    '/settings/canned-responses',
    { config: { scopes: ['canned_responses--all:ro', 'canned_responses--groups:ro'] } },
    async (request, reply) => {
      const query = parse(cannedListQuery, request.query);

      const items = await request.withTenant((tx) =>
        tx.cannedResponse.findMany({
          where: query.scope ? { scope: query.scope } : {},
          orderBy: { shortcut: 'asc' },
        }),
      );

      return reply.send({ items: items.map(serialiseCanned) });
    },
  );

  app.post(
    '/settings/canned-responses',
    { config: { scopes: ['canned_responses--all:rw'] } },
    async (request, reply) => {
      const body = parse(createCannedBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      try {
        const created = await request.withTenant((tx) =>
          tx.cannedResponse.create({
            data: {
              licenseId: tenant.licenseId,
              shortcut: body.shortcut,
              text: body.text,
              scope: body.scope,
              updatedBy: principal.kind === 'agent' ? principal.accountId : null,
              updatedAt: new Date(),
            },
          }),
        );
        return reply.status(201).send(serialiseCanned(created));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(
            'not_allowed',
            `#${body.shortcut} is already used for ${body.scope} replies.`,
          );
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { cannedResponseId: string } }>(
    '/settings/canned-responses/:cannedResponseId',
    { config: { scopes: ['canned_responses--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.cannedResponseId);
      const body = parse(updateCannedBody, request.body);
      const principal = request.requirePrincipal();

      try {
        const updated = await request.withTenant(async (tx) => {
          const existing = await tx.cannedResponse.findFirst({
            where: { id },
            select: { id: true },
          });
          if (!existing) throw ApiError.notFound('Saved reply not found.');

          return tx.cannedResponse.update({
            where: { id },
            data: {
              ...(body.shortcut !== undefined ? { shortcut: body.shortcut } : {}),
              ...(body.text !== undefined ? { text: body.text } : {}),
              updatedBy: principal.kind === 'agent' ? principal.accountId : null,
              updatedAt: new Date(),
            },
          });
        });
        return reply.send(serialiseCanned(updated));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError('not_allowed', 'That shortcut is already used.');
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { cannedResponseId: string } }>(
    '/settings/canned-responses/:cannedResponseId',
    { config: { scopes: ['canned_responses--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.cannedResponseId);

      const deleted = await request.withTenant(async (tx) => {
        const { count } = await tx.cannedResponse.deleteMany({ where: { id } });
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Saved reply not found.');

      return reply.status(204).send();
    },
  );

  // --- Security / file sharing -----------------------------------------------

  app.get(
    '/settings/security',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      // `findFirst` with no `where`: RLS narrows it to this license, and the
      // id-by-licenseId key means there is at most one row to find.
      const row = await request.withTenant((tx) => tx.securitySettings.findFirst());
      return reply.send(serialiseSecurity(row));
    },
  );

  app.patch(
    '/settings/security',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(updateSecurityBody, request.body);
      const tenant = request.tenant();

      const data = {
        ...(body.file_sharing_enabled !== undefined
          ? { fileSharingEnabled: body.file_sharing_enabled }
          : {}),
        ...(body.allowed_file_types !== undefined
          ? { allowedFileTypes: body.allowed_file_types }
          : {}),
        ...(body.max_file_size_bytes !== undefined
          ? { maxFileSizeBytes: body.max_file_size_bytes }
          : {}),
        ...(body.spam_filter_enabled !== undefined
          ? { spamFilterEnabled: body.spam_filter_enabled }
          : {}),
        ...(body.require_two_factor !== undefined
          ? { requireTwoFactor: body.require_two_factor }
          : {}),
      };

      // Upsert because signup leaves no row: a workspace saving these for the
      // first time would otherwise get a 404 for settings it can plainly see.
      const updated = await request.withTenant((tx) =>
        tx.securitySettings.upsert({
          where: { licenseId: tenant.licenseId },
          create: {
            ...SECURITY_DEFAULTS,
            allowedFileTypes: [...SECURITY_DEFAULTS.allowedFileTypes],
            ...data,
            licenseId: tenant.licenseId,
          },
          update: data,
        }),
      );

      return reply.send(serialiseSecurity(updated));
    },
  );

  // --- Routing rules ---------------------------------------------------------

  app.get(
    '/settings/routing-rules',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const { rules, groups } = await request.withTenant(async (tx) => ({
        rules: await tx.routingRule.findMany({
          orderBy: [{ isFallback: 'asc' }, { priority: 'asc' }],
        }),
        groups: await tx.group.findMany({ select: { id: true, name: true } }),
      }));

      const names = new Map(groups.map((g) => [g.id.toString(), g.name]));

      return reply.send({
        items: rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          kind: rule.kind,
          conditions: rule.conditions,
          target_group_id: rule.targetGroupId === null ? null : Number(rule.targetGroupId),
          // Resolved here so the UI does not have to fetch groups separately
          // just to render a rule as anything other than a bare number.
          target_group_name:
            rule.targetGroupId === null ? null : (names.get(rule.targetGroupId.toString()) ?? null),
          priority: rule.priority,
          is_fallback: rule.isFallback,
          enabled: rule.enabled,
        })),
      });
    },
  );

  app.patch<{ Params: { ruleId: string } }>(
    '/settings/routing-rules/:ruleId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const ruleId = parse(uuid, request.params.ruleId);
      const body = parse(updateRuleBody, request.body);

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.routingRule.findFirst({ where: { id: ruleId } });
        if (!existing) throw ApiError.notFound('Routing rule not found.');

        // Disabling the fallback would leave conversations that match no rule
        // with nowhere to go. They would sit unassigned, and nothing about the
        // configuration would look wrong.
        if (existing.isFallback && body.enabled === false) {
          throw new ApiError(
            'not_allowed',
            'The fallback rule cannot be disabled — conversations matching nothing would be dropped.',
          );
        }

        if (body.target_group_id !== undefined && body.target_group_id !== null) {
          const group = await tx.group.findFirst({
            where: { id: body.target_group_id },
            select: { id: true },
          });
          if (!group) throw ApiError.validation('That team does not exist.');
        }

        return tx.routingRule.update({
          where: { id: ruleId },
          data: {
            ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
            ...(body.priority !== undefined ? { priority: body.priority } : {}),
            ...(body.target_group_id !== undefined ? { targetGroupId: body.target_group_id } : {}),
          },
        });
      });

      const groupName =
        updated.targetGroupId === null
          ? null
          : ((
              await request.withTenant((tx) =>
                tx.group.findFirst({
                  where: { id: updated.targetGroupId! },
                  select: { name: true },
                }),
              )
            )?.name ?? null);

      return reply.send({
        id: updated.id,
        name: updated.name,
        kind: updated.kind,
        conditions: updated.conditions,
        target_group_id: updated.targetGroupId === null ? null : Number(updated.targetGroupId),
        target_group_name: groupName,
        priority: updated.priority,
        is_fallback: updated.isFallback,
        enabled: updated.enabled,
      });
    },
  );

  // --- Tag library -----------------------------------------------------------

  // Read is open to any tag scope, `--groups` included, because the inbox reads
  // this list to suggest tags as an agent types: an ordinary agent (who holds
  // `tags--groups:ro`, not the tenant-wide set) still needs to see the
  // vocabulary they are expected to apply.
  app.get(
    '/settings/tags',
    { config: { scopes: ['tags--all:ro', 'tags--groups:ro'] } },
    async (request, reply) => {
      const items = await request.withTenant((tx) =>
        tx.tag.findMany({
          orderBy: { name: 'asc' },
          include: { _count: { select: { threads: true } } },
        }),
      );
      return reply.send({ items: items.map(serialiseTag) });
    },
  );

  app.post(
    '/settings/tags',
    { config: { scopes: ['tags--all:rw'] } },
    async (request, reply) => {
      const body = parse(createTagBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      try {
        const created = await request.withTenant(async (tx) => {
          await assertGroupsExist(tx, body.group_ids);
          return tx.tag.create({
            data: {
              licenseId: tenant.licenseId,
              name: body.name,
              groupIds: body.group_ids,
              authorId: principal.kind === 'agent' ? principal.accountId : null,
            },
            include: { _count: { select: { threads: true } } },
          });
        });
        return reply.status(201).send(serialiseTag(created));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError('not_allowed', `The tag “${body.name}” already exists.`);
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { tagId: string } }>(
    '/settings/tags/:tagId',
    { config: { scopes: ['tags--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.tagId);
      const body = parse(updateTagBody, request.body);

      try {
        const updated = await request.withTenant(async (tx) => {
          const existing = await tx.tag.findFirst({ where: { id }, select: { id: true } });
          if (!existing) throw ApiError.notFound('Tag not found.');
          if (body.group_ids !== undefined) await assertGroupsExist(tx, body.group_ids);

          return tx.tag.update({
            where: { id },
            data: {
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.group_ids !== undefined ? { groupIds: body.group_ids } : {}),
            },
            include: { _count: { select: { threads: true } } },
          });
        });
        return reply.send(serialiseTag(updated));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError('not_allowed', 'A tag with that name already exists.');
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { tagId: string } }>(
    '/settings/tags/:tagId',
    { config: { scopes: ['tags--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.tagId);

      const deleted = await request.withTenant(async (tx) => {
        // Scoped delete, not `delete by id`: the id alone would let a caller
        // remove another tenant's tag if RLS were ever misconfigured.
        const { count } = await tx.tag.deleteMany({ where: { id } });
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Tag not found.');

      return reply.status(204).send();
    },
  );
}

/**
 * Rejects a create/update that names a team the workspace does not have.
 *
 * Mirrors the check the routing-rule editor makes: a `group_id` that resolves to
 * nothing would scope a tag to a team that cannot exist, so it would silently
 * apply to no one. RLS narrows the lookup to this tenant, so referencing another
 * workspace's group fails here exactly as an unknown id does.
 */
async function assertGroupsExist(
  tx: Prisma.TransactionClient,
  groupIds: bigint[],
): Promise<void> {
  if (groupIds.length === 0) return;
  const unique = [...new Set(groupIds.map((id) => id.toString()))];
  const found = await tx.group.findMany({
    where: { id: { in: groupIds } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw ApiError.validation('One or more of those teams do not exist.');
  }
}

function serialiseTag(row: {
  id: string;
  name: string;
  groupIds: bigint[];
  authorId: string | null;
  createdAt: Date;
  _count?: { threads: number };
}) {
  return {
    id: row.id,
    name: row.name,
    group_ids: row.groupIds.map((id) => Number(id)),
    author_id: row.authorId,
    usage_count: row._count?.threads ?? 0,
    created_at: row.createdAt.toISOString(),
  };
}

function serialiseSecurity(
  row: {
    fileSharingEnabled: boolean;
    allowedFileTypes: string[];
    maxFileSizeBytes: number;
    spamFilterEnabled: boolean;
    requireTwoFactor: boolean;
    updatedAt: Date;
  } | null,
) {
  const value = row ?? SECURITY_DEFAULTS;
  return {
    file_sharing_enabled: value.fileSharingEnabled,
    allowed_file_types: [...value.allowedFileTypes],
    max_file_size_bytes: value.maxFileSizeBytes,
    spam_filter_enabled: value.spamFilterEnabled,
    require_two_factor: value.requireTwoFactor,
    updated_at: row ? row.updatedAt.toISOString() : null,
  };
}

function serialiseCanned(row: {
  id: string;
  shortcut: string;
  text: string;
  scope: string;
  groupId: bigint | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    shortcut: row.shortcut,
    text: row.text,
    scope: row.scope,
    group_id: row.groupId === null ? null : Number(row.groupId),
    updated_by: row.updatedBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
